"""Dependency vulnerability checker (offline, curated list).

Parses requirements.txt, pyproject.toml, and package.json. Compares
package names and versions against the bundled vulnerable_packages.json.

**Important**: This is a small curated offline list (~15 entries), NOT a
complete vulnerability database. It demonstrates the concept but should
not be relied upon as the sole source of vulnerability information.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from .base import Analyzer
from ..models import Category, Confidence, Finding, Severity
from ..config import DATA_DIR

log = logging.getLogger("codepulse.analyzers.dependencies")


def _load_vuln_db() -> list[dict[str, Any]]:
    """Load the curated vulnerability database."""
    db_path = DATA_DIR / "vulnerable_packages.json"
    if not db_path.exists():
        log.warning("Vulnerability database not found at %s", db_path)
        return []
    with open(db_path) as f:
        return json.load(f)


def _parse_version(version_str: str) -> tuple[int, ...]:
    """Parse a version string like '1.2.3' into a comparable tuple."""
    parts = re.findall(r"\d+", version_str)
    return tuple(int(p) for p in parts) if parts else (0,)


def _version_in_range(version: str, range_str: str) -> bool:
    """Check if version falls within the vulnerable range.

    Supports formats like: '<1.26.0', '>=1.0,<2.0', '==1.2.3', '*' (any version).
    """
    if not version or range_str == "*":
        return True

    ver = _parse_version(version)
    conditions = [c.strip() for c in range_str.split(",")]

    for cond in conditions:
        if cond.startswith("<="):
            if not (ver <= _parse_version(cond[2:])):
                return False
        elif cond.startswith(">="):
            if not (ver >= _parse_version(cond[2:])):
                return False
        elif cond.startswith("<"):
            if not (ver < _parse_version(cond[1:])):
                return False
        elif cond.startswith(">"):
            if not (ver > _parse_version(cond[1:])):
                return False
        elif cond.startswith("=="):
            if not (ver == _parse_version(cond[2:])):
                return False
        elif cond.startswith("!="):
            if not (ver != _parse_version(cond[2:])):
                return False
        else:
            # Just a version number, treat as ==
            if not (ver == _parse_version(cond)):
                return False
    return True


def _parse_requirements_txt(source: str) -> list[tuple[str, str]]:
    """Parse requirements.txt format. Returns list of (package, version)."""
    deps: list[tuple[str, str]] = []
    for line in source.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        # Match: package==version, package>=version, etc.
        m = re.match(r"([A-Za-z0-9_.-]+)\s*([<>=!~]+\s*[\d.]+(?:\s*,\s*[<>=!~]+\s*[\d.]+)*)?", line)
        if m:
            name = m.group(1).lower()
            ver_spec = m.group(2) or ""
            # Extract just the version number for ==
            ver_match = re.search(r"==\s*([\d.]+)", ver_spec)
            version = ver_match.group(1) if ver_match else ""
            deps.append((name, version))
    return deps


def _parse_package_json(source: str) -> list[tuple[str, str]]:
    """Parse package.json dependencies."""
    deps: list[tuple[str, str]] = []
    try:
        data = json.loads(source)
    except json.JSONDecodeError:
        return deps

    for section in ("dependencies", "devDependencies"):
        for name, ver in data.get(section, {}).items():
            # Strip ^ ~ >= etc.
            clean = re.sub(r"[^0-9.]", "", ver)
            deps.append((name.lower(), clean))
    return deps


def _parse_pyproject_toml(source: str) -> list[tuple[str, str]]:
    """Parse pyproject.toml dependencies."""
    deps: list[tuple[str, str]] = []
    try:
        import toml
        data = toml.loads(source)
    except Exception:
        return deps

    # PEP 621
    dep_list = data.get("project", {}).get("dependencies", [])
    for dep_str in dep_list:
        m = re.match(r"([A-Za-z0-9_.-]+)\s*([<>=!~]+\s*[\d.]+)?", dep_str)
        if m:
            name = m.group(1).lower()
            ver_spec = m.group(2) or ""
            ver_match = re.search(r"==\s*([\d.]+)", ver_spec)
            version = ver_match.group(1) if ver_match else ""
            deps.append((name, version))

    return deps


class DependencyAnalyzer(Analyzer):
    name = "dependencies"

    def __init__(self):
        self._vuln_db = _load_vuln_db()
        self._vuln_lookup: dict[str, list[dict]] = {}
        for entry in self._vuln_db:
            name = entry["package"].lower()
            self._vuln_lookup.setdefault(name, []).append(entry)

    def supports(self, path: str) -> bool:
        basename = Path(path).name
        return basename in ("requirements.txt", "package.json", "pyproject.toml")

    def analyze(self, path: str, source: str) -> list[Finding]:
        findings: list[Finding] = []
        basename = Path(path).name

        if basename == "requirements.txt":
            deps = _parse_requirements_txt(source)
        elif basename == "package.json":
            deps = _parse_package_json(source)
        elif basename == "pyproject.toml":
            deps = _parse_pyproject_toml(source)
        else:
            return findings

        for pkg_name, version in deps:
            vulns = self._vuln_lookup.get(pkg_name, [])
            for vuln in vulns:
                if _version_in_range(version, vuln.get("vulnerable_range", "*")):
                    sev = Severity(vuln.get("severity", "medium"))
                    findings.append(Finding(
                        file=path,
                        line=self._find_line(source, pkg_name),
                        rule_id="CP-DEP-001",
                        category=Category.dependency,
                        severity=sev,
                        confidence=Confidence.high,
                        title=f"Vulnerable dependency: {pkg_name}",
                        message=(
                            f"{pkg_name} {version or '(any version)'} has a known vulnerability: "
                            f"{vuln.get('advisory_id', 'N/A')} — {vuln.get('note', '')}"
                        ),
                        why_it_matters=vuln.get("note", "This package version has a known security vulnerability."),
                        suggested_fix=f"Upgrade to {vuln.get('fixed_version', 'the latest version')}.",
                        snippet=f"{pkg_name}=={version}" if version else pkg_name,
                        cwe=vuln.get("cwe"),
                    ))

        return findings

    def _find_line(self, source: str, pkg_name: str) -> int:
        """Find the line number where a package is mentioned."""
        for i, line in enumerate(source.splitlines(), 1):
            if pkg_name in line.lower():
                return i
        return 1
