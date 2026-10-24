"""Pydantic data models for CodePulse findings, reports and enums."""

from __future__ import annotations

import hashlib
import re
import textwrap
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


# ── Enums ──────────────────────────────────────────────────────────────

class Severity(str, Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"
    info = "info"


class Category(str, Enum):
    security = "security"
    complexity = "complexity"
    smell = "smell"
    duplicate = "duplicate"
    dependency = "dependency"


class Confidence(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


# ── Finding ────────────────────────────────────────────────────────────

def _normalize_snippet(snippet: str) -> str:
    """Collapse whitespace to produce a stable string for fingerprinting."""
    return re.sub(r"\s+", " ", snippet.strip())


def compute_fingerprint(file: str, rule_id: str, snippet: str) -> str:
    """Stable hash of (file, rule_id, normalised snippet).

    Keeps its identity when only lines shift.
    """
    payload = f"{file}:{rule_id}:{_normalize_snippet(snippet)}"
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


class Finding(BaseModel):
    """A single code-health finding."""

    id: str = ""
    file: str
    line: int
    end_line: Optional[int] = None
    rule_id: str
    category: Category
    severity: Severity
    confidence: Confidence = Confidence.high
    title: str
    message: str
    why_it_matters: str = ""
    suggested_fix: str = ""
    snippet: str = ""
    fingerprint: str = ""
    is_new: bool = False
    dismissed: bool = False
    dismissed_reason: Optional[str] = None
    cwe: Optional[str] = None

    def ensure_fingerprint(self) -> None:
        """Compute *fingerprint* and *id* if they are missing."""
        if not self.fingerprint:
            self.fingerprint = compute_fingerprint(self.file, self.rule_id, self.snippet or self.message)
        if not self.id:
            self.id = self.fingerprint


# ── File & Project Reports ─────────────────────────────────────────────

class FileReport(BaseModel):
    path: str
    language: str = "unknown"
    loc: int = 0
    findings: list[Finding] = Field(default_factory=list)
    complexity_avg: float = 0.0
    complexity_max: int = 0
    analyzed_at: Optional[str] = None
    duration_ms: float = 0.0


class TrendPoint(BaseModel):
    ts: str
    score: float
    counts: dict[str, int] = Field(default_factory=dict)


class ProjectReport(BaseModel):
    score: float = 100.0
    grade: str = "A"
    counts_by_severity: dict[str, int] = Field(default_factory=dict)
    counts_by_category: dict[str, int] = Field(default_factory=dict)
    files: list[FileReport] = Field(default_factory=list)
    trend: list[TrendPoint] = Field(default_factory=list)
    total_files: int = 0
    total_loc: int = 0
    total_findings: int = 0
