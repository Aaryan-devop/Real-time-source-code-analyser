"""Language-agnostic secret detection via regex + entropy.

Rules
-----
- AWS access keys (AKIA...)
- Private key blocks (-----BEGIN ... PRIVATE KEY-----)
- Generic password/secret/token/api_key = "..." assignments
- Bearer tokens
- Connection strings with credentials
- High-entropy strings assigned to suspicious names

The finding snippet is always **redacted** (first 3 chars + ***).
Obvious placeholders (changeme, your_api_key, xxxx, example) are ignored or flagged low confidence.
"""

from __future__ import annotations

import math
import re
import logging
from typing import NamedTuple

from .base import Analyzer
from ..models import Category, Confidence, Finding, Severity

log = logging.getLogger("codepulse.analyzers.secrets")

# ── Redaction ──────────────────────────────────────────────────────────

def _redact(value: str) -> str:
    """Show first 3 characters then mask the rest."""
    if len(value) <= 3:
        return "***"
    return value[:3] + "***"


# ── Entropy ────────────────────────────────────────────────────────────

def _shannon_entropy(s: str) -> float:
    """Calculate the Shannon entropy of a string."""
    if not s:
        return 0.0
    freq: dict[str, int] = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    length = len(s)
    return -sum((count / length) * math.log2(count / length) for count in freq.values())


# ── Placeholders ───────────────────────────────────────────────────────

PLACEHOLDER_PATTERNS = re.compile(
    r"^(changeme|your_api_key|xxxx+|example|placeholder|dummy|test|TODO|REPLACE_ME|"
    r"none|null|undefined|\.\.\.|\*+|insert.here|fill.in)$",
    re.IGNORECASE,
)


def _is_placeholder(value: str) -> bool:
    return bool(PLACEHOLDER_PATTERNS.match(value.strip().strip("\"' ")))


# ── Patterns ───────────────────────────────────────────────────────────

class _Pattern(NamedTuple):
    rule_id: str
    title: str
    pattern: re.Pattern
    severity: Severity
    group: int  # which regex group holds the secret value

PATTERNS: list[_Pattern] = [
    _Pattern(
        "CP-SCR-001", "AWS Access Key",
        re.compile(r"(AKIA[0-9A-Z]{16})"),
        Severity.critical, 1,
    ),
    _Pattern(
        "CP-SCR-002", "Private Key block",
        re.compile(r"(-----BEGIN\s+(?:RSA |DSA |EC )?PRIVATE KEY-----)"),
        Severity.critical, 1,
    ),
    _Pattern(
        "CP-SCR-003", "Hardcoded secret assignment",
        re.compile(
            r"""(?:password|passwd|secret|api_key|apikey|access_token|auth_token|token|private_key)"""
            r"""\s*[=:]\s*['"]([^'"]{4,})['"]""",
            re.IGNORECASE,
        ),
        Severity.high, 1,
    ),
    _Pattern(
        "CP-SCR-004", "Bearer token",
        re.compile(r"""['\"]Bearer\s+([A-Za-z0-9_\-\.]{20,})['\"]"""),
        Severity.high, 1,
    ),
    _Pattern(
        "CP-SCR-005", "Connection string with credentials",
        re.compile(
            r"""(?:mysql|postgres|postgresql|mongodb|redis|amqp)://[^:]+:([^@]+)@""",
            re.IGNORECASE,
        ),
        Severity.high, 1,
    ),
]

# Names that suggest a secret variable
SUSPICIOUS_NAMES = re.compile(
    r"\b(password|passwd|secret|api_key|apikey|token|private_key|auth|credential)\b",
    re.IGNORECASE,
)


class SecretsAnalyzer(Analyzer):
    name = "secrets"

    def supports(self, path: str) -> bool:
        # Works on any text file
        return True

    def analyze(self, path: str, source: str) -> list[Finding]:
        findings: list[Finding] = []
        lines = source.splitlines()

        for i, line in enumerate(lines, 1):
            # Skip comments in many languages
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("#"):
                # Still check — secrets in comments are still secrets
                pass

            for pat in PATTERNS:
                m = pat.pattern.search(line)
                if m:
                    secret_value = m.group(pat.group)
                    if _is_placeholder(secret_value):
                        continue

                    conf = Confidence.high
                    sev = pat.severity

                    # Downgrade if it looks like a test file
                    if "test" in path.lower() or "fixture" in path.lower():
                        conf = Confidence.low
                        sev = Severity.low

                    findings.append(Finding(
                        file=path, line=i,
                        rule_id=pat.rule_id,
                        category=Category.security,
                        severity=sev,
                        confidence=conf,
                        title=pat.title,
                        message=f"{pat.title} detected (redacted: {_redact(secret_value)})",
                        why_it_matters="Hardcoded secrets can be extracted from source code, version control, or compiled artifacts.",
                        suggested_fix="Store secrets in environment variables or a secrets manager, not in source code.",
                        snippet=_redact(secret_value),
                        cwe="CWE-798",
                    ))

            # High-entropy check for suspicious variable names
            if SUSPICIOUS_NAMES.search(line):
                # Extract assigned string values
                str_match = re.search(r"""=\s*['"]([^'"]{8,})['"]""", line)
                if str_match:
                    val = str_match.group(1)
                    if _is_placeholder(val):
                        continue
                    entropy = _shannon_entropy(val)
                    if entropy > 4.0:  # high entropy threshold
                        # Avoid duplicates with pattern matches above
                        already = any(
                            f.line == i and f.rule_id.startswith("CP-SCR")
                            for f in findings
                        )
                        if not already:
                            conf = Confidence.medium
                            sev = Severity.medium
                            if "test" in path.lower():
                                conf = Confidence.low
                                sev = Severity.low
                            findings.append(Finding(
                                file=path, line=i,
                                rule_id="CP-SCR-006",
                                category=Category.security,
                                severity=sev,
                                confidence=conf,
                                title="High-entropy string in suspicious variable",
                                message=f"Possible secret (redacted: {_redact(val)}, entropy={entropy:.1f})",
                                why_it_matters="High-entropy strings assigned to variables with names like 'password' or 'token' are likely secrets.",
                                suggested_fix="Move this value to an environment variable or secrets manager.",
                                snippet=_redact(val),
                                cwe="CWE-798",
                            ))

        return findings
