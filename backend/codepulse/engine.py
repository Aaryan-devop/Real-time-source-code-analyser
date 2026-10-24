"""Analysis engine — orchestrates analysis of a single file.

Responsibilities:
- Read the file, compute content hash, skip if unchanged (cache hit)
- Run all applicable analyzers
- Assign fingerprints, mark is_new via git diff
- Apply stored dismissals
- Save to SQLite
- Return a FileReport

A crash in one analyzer never stops the others.
A file with a syntax error produces a single info finding.
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import db
from .analyzers.py_complexity import PythonComplexityAnalyzer
from .analyzers.py_smells import PythonSmellsAnalyzer
from .analyzers.py_security import PythonSecurityAnalyzer
from .analyzers.secrets import SecretsAnalyzer
from .analyzers.js_analyzer import JavaScriptAnalyzer
from .analyzers.duplicates import DuplicateDetector
from .analyzers.dependencies import DependencyAnalyzer
from .gitdiff import get_repo_root, is_git_repo, mark_new_findings
from .models import Category, Confidence, FileReport, Finding, Severity
from .score import calculate_score, counts_by_severity, counts_by_category

log = logging.getLogger("codepulse.engine")

# ── Singleton analyzers ────────────────────────────────────────────────

_complexity = PythonComplexityAnalyzer()
_smells = PythonSmellsAnalyzer()
_security = PythonSecurityAnalyzer()
_secrets = SecretsAnalyzer()
_js = JavaScriptAnalyzer()
_duplicates = DuplicateDetector()
_dependencies = DependencyAnalyzer()

ALL_ANALYZERS = [_complexity, _smells, _security, _secrets, _js, _duplicates, _dependencies]

# ── Language detection ─────────────────────────────────────────────────

LANGUAGE_MAP = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mjs": "javascript",
    ".cjs": "javascript",
}


def detect_language(path: str) -> str:
    suffix = Path(path).suffix.lower()
    return LANGUAGE_MAP.get(suffix, "unknown")


# ── Engine ─────────────────────────────────────────────────────────────

_watched_root: str | None = None


def set_watched_root(root: str) -> None:
    global _watched_root
    _watched_root = root


def get_watched_root() -> str | None:
    return _watched_root


def _content_hash(source: str) -> str:
    return hashlib.sha256(source.encode()).hexdigest()[:16]


def _check_syntax(path: str, source: str, language: str) -> Finding | None:
    """Return a syntax-error finding if the file can't be parsed, else None."""
    if language == "python":
        try:
            compile(source, path, "exec")
        except SyntaxError as exc:
            return Finding(
                file=path, line=exc.lineno or 1,
                rule_id="CP-SYN-001",
                category=Category.smell,
                severity=Severity.info,
                confidence=Confidence.medium,
                title=f"Syntax error at line {exc.lineno or '?'}",
                message=str(exc.msg) if exc.msg else "Syntax error",
                why_it_matters="Files with syntax errors cannot be fully analysed.",
                suggested_fix="Fix the syntax error and save again.",
                snippet=(source.splitlines()[exc.lineno - 1] if exc.lineno and exc.lineno <= len(source.splitlines()) else ""),
            )
    return None


def analyze_file(path: str, force: bool = False) -> FileReport | None:
    """Analyse a single file and return a FileReport.

    Returns None if the file cannot be read (deleted, binary, etc.).
    """
    t0 = time.perf_counter()
    abs_path = Path(path).resolve()

    if not abs_path.is_file():
        return None

    try:
        source = abs_path.read_text(encoding="utf-8", errors="replace")
    except (OSError, UnicodeDecodeError) as exc:
        log.warning("Cannot read %s: %s", path, exc)
        return None

    # Content-hash caching
    h = _content_hash(source)
    if not force:
        cached_hash = db.get_file_hash(str(abs_path))
        if cached_hash == h:
            # Cache hit — return existing data
            data = db.get_file_report_data(str(abs_path))
            if data:
                return FileReport(
                    path=data["path"], language=data["language"],
                    loc=data["loc"], findings=data["findings"],
                    analyzed_at=data["analyzed_at"],
                    duration_ms=0.0,
                )
            # Fall through if db data is missing

    language = detect_language(str(abs_path))
    loc = len(source.splitlines())

    # Check syntax first
    findings: list[Finding] = []
    syntax_err = _check_syntax(str(abs_path), source, language)
    if syntax_err:
        findings.append(syntax_err)

    # Run all applicable analyzers
    complexity_avg = 0.0
    complexity_max = 0

    for analyzer in ALL_ANALYZERS:
        if not analyzer.supports(str(abs_path)):
            continue
        try:
            result = analyzer.analyze(str(abs_path), source)
            findings.extend(result)

            # Capture complexity stats
            if isinstance(analyzer, PythonComplexityAnalyzer):
                complexity_avg = analyzer.complexity_avg
                complexity_max = analyzer.complexity_max

        except Exception as exc:
            log.error("Analyzer '%s' crashed on %s: %s", analyzer.name, path, exc, exc_info=True)
            findings.append(Finding(
                file=str(abs_path), line=1,
                rule_id="CP-ERR-001",
                category=Category.smell,
                severity=Severity.info,
                confidence=Confidence.high,
                title=f"Analyzer error ({analyzer.name})",
                message=f"Analyzer '{analyzer.name}' encountered an error: {exc}",
                why_it_matters="An internal analyzer error means some checks could not run.",
                suggested_fix="This is likely a CodePulse bug. Please report it.",
                snippet="",
            ))

    # Assign fingerprints
    for f in findings:
        f.ensure_fingerprint()

    # Mark new findings via git
    repo_root = get_repo_root(_watched_root) if _watched_root else None
    mark_new_findings(findings, str(abs_path), repo_root)

    # Apply dismissals
    db.apply_dismissals(findings)

    # Persist
    db.upsert_file(str(abs_path), h, language, loc)
    db.save_findings(str(abs_path), findings)

    duration_ms = round((time.perf_counter() - t0) * 1000, 1)

    return FileReport(
        path=str(abs_path),
        language=language,
        loc=loc,
        findings=findings,
        complexity_avg=complexity_avg,
        complexity_max=complexity_max,
        analyzed_at=datetime.now(timezone.utc).isoformat(),
        duration_ms=duration_ms,
    )


def remove_file(path: str) -> None:
    """Remove a file's data from the database and duplicate index."""
    abs_path = str(Path(path).resolve())
    db.delete_file(abs_path)
    _duplicates.remove_file(abs_path)


def get_project_report() -> dict[str, Any]:
    """Build a full ProjectReport from the current database state."""
    from .models import ProjectReport, TrendPoint

    all_files = db.get_all_files()
    all_findings = db.get_findings(include_dismissed=True)

    total_loc = sum(f["loc"] for f in all_files)
    score, grade = calculate_score(all_findings, total_loc)
    sev_counts = counts_by_severity(all_findings)
    cat_counts = counts_by_category(all_findings)
    trend = db.get_history()

    # Build file reports
    file_reports = []
    for f in all_files:
        file_findings = [fd for fd in all_findings if fd.file == f["path"]]
        file_reports.append(FileReport(
            path=f["path"],
            language=f["language"],
            loc=f["loc"],
            findings=file_findings,
            analyzed_at=f["analyzed_at"],
        ))

    active_findings = [f for f in all_findings if not f.dismissed]

    return ProjectReport(
        score=score, grade=grade,
        counts_by_severity=sev_counts,
        counts_by_category=cat_counts,
        files=file_reports,
        trend=trend,
        total_files=len(all_files),
        total_loc=total_loc,
        total_findings=len(active_findings),
    ).model_dump()


def record_history() -> None:
    """Store a history point for the current state."""
    all_findings = db.get_findings(include_dismissed=True)
    all_files = db.get_all_files()
    total_loc = sum(f["loc"] for f in all_files)
    score, _ = calculate_score(all_findings, total_loc)
    sev_counts = counts_by_severity(all_findings)
    db.add_history_point(score, sev_counts)
