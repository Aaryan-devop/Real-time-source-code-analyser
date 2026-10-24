"""Health score calculation.

Formula
-------
Start at 100 and subtract weighted penalties per finding:
  penalty = severity_weight[finding.severity]
  
To avoid unfairly zeroing large projects, normalise by lines of code:
  raw_penalty = sum(penalties)
  normalised_penalty = raw_penalty * (1000 / max(loc, 1000))
  score = max(0, 100 - normalised_penalty)

Dismissed findings don't count.

Grade mapping:  A ≥ 90,  B ≥ 80,  C ≥ 70,  D ≥ 60,  F < 60
"""

from __future__ import annotations

from .config import get_settings
from .models import Finding, Severity


def score_to_grade(score: float) -> str:
    """Map a 0–100 score to a letter grade."""
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


def calculate_score(findings: list[Finding], total_loc: int) -> tuple[float, str]:
    """Return (score, grade) for the given findings.

    Dismissed findings are excluded from the calculation.
    """
    settings = get_settings()
    weights = settings.severity_weights

    raw_penalty = 0.0
    for f in findings:
        if f.dismissed:
            continue
        raw_penalty += weights.get(f.severity.value, 0)

    # Normalise: a project with 5 000 LOC and 10 findings is healthier than
    # a 200-LOC file with 10 findings.
    loc = max(total_loc, 1000)  # floor to prevent tiny projects from being punished less
    normalised_penalty = raw_penalty * (1000 / loc)
    score = max(0.0, min(100.0, 100.0 - normalised_penalty))
    score = round(score, 1)
    return score, score_to_grade(score)


def counts_by_severity(findings: list[Finding]) -> dict[str, int]:
    """Count non-dismissed findings by severity."""
    counts: dict[str, int] = {s.value: 0 for s in Severity}
    for f in findings:
        if not f.dismissed:
            counts[f.severity.value] = counts.get(f.severity.value, 0) + 1
    return counts


def counts_by_category(findings: list[Finding]) -> dict[str, int]:
    """Count non-dismissed findings by category."""
    from .models import Category
    counts: dict[str, int] = {c.value: 0 for c in Category}
    for f in findings:
        if not f.dismissed:
            counts[f.category.value] = counts.get(f.category.value, 0) + 1
    return counts
