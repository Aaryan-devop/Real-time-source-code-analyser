"""Duplicate code block detection across project files.

Uses normalised token windows and rolling hashes to find duplicated
blocks of code (minimum ~6 lines / ~50 tokens). Reports both locations.

Designed for incremental updates: when a single file changes, only that
file's tokens are recomputed; existing token data for other files is reused.
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections import defaultdict
from typing import NamedTuple

from .base import Analyzer
from ..models import Category, Confidence, Finding, Severity

log = logging.getLogger("codepulse.analyzers.duplicates")

MIN_LINES = 6
MIN_TOKENS = 50


class _Block(NamedTuple):
    file: str
    start_line: int
    end_line: int
    token_hash: str


# Module-level cache: file -> list of blocks
_file_blocks: dict[str, list[_Block]] = {}


def _tokenize(source: str) -> list[tuple[str, int]]:
    """Return (token, line_number) pairs, normalising whitespace and identifiers."""
    tokens: list[tuple[str, int]] = []
    for i, line in enumerate(source.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("//"):
            continue
        for tok in re.findall(r"[A-Za-z_]\w*|[^\s]", stripped):
            tokens.append((tok, i))
    return tokens


def _compute_blocks(path: str, source: str) -> list[_Block]:
    """Compute rolling-hash blocks for a file."""
    tokens = _tokenize(source)
    blocks: list[_Block] = []
    if len(tokens) < MIN_TOKENS:
        return blocks

    window = MIN_TOKENS
    for i in range(len(tokens) - window + 1):
        window_tokens = tokens[i: i + window]
        text = " ".join(t for t, _ in window_tokens)
        h = hashlib.md5(text.encode()).hexdigest()
        start_line = window_tokens[0][1]
        end_line = window_tokens[-1][1]
        if end_line - start_line + 1 >= MIN_LINES:
            blocks.append(_Block(path, start_line, end_line, h))
    return blocks


class DuplicateDetector(Analyzer):
    """Project-wide duplicate block detector.

    Call *update_file* for each file to build up the index, then
    *find_duplicates* to get the findings.

    The standard *analyze* method works but only returns duplicates
    relative to already-indexed files.
    """

    name = "duplicates"

    def supports(self, path: str) -> bool:
        return path.endswith((".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".go", ".rb"))

    def update_file(self, path: str, source: str) -> None:
        """Recompute blocks for a single file (incremental update)."""
        _file_blocks[path] = _compute_blocks(path, source)

    def remove_file(self, path: str) -> None:
        _file_blocks.pop(path, None)

    def analyze(self, path: str, source: str) -> list[Finding]:
        """Find duplicates between *path* and all other indexed files."""
        self.update_file(path, source)
        return self.find_duplicates_for(path)

    def find_duplicates_for(self, path: str) -> list[Finding]:
        """Return duplicate findings for *path* against all other indexed files."""
        findings: list[Finding] = []
        my_blocks = _file_blocks.get(path, [])
        if not my_blocks:
            return findings

        # Build a hash -> (file, start, end) lookup for other files
        other_index: dict[str, list[_Block]] = defaultdict(list)
        for other_path, blocks in _file_blocks.items():
            if other_path == path:
                continue
            for b in blocks:
                other_index[b.token_hash].append(b)

        # Deduplicate: only report each pair once
        seen: set[tuple[str, int, str, int]] = set()

        for b in my_blocks:
            matches = other_index.get(b.token_hash, [])
            for m in matches:
                key = (min(b.file, m.file), min(b.start_line, m.start_line),
                       max(b.file, m.file), max(b.start_line, m.start_line))
                if key in seen:
                    continue
                seen.add(key)

                lines_count = b.end_line - b.start_line + 1
                sev = Severity.medium if lines_count > 15 else Severity.low

                findings.append(Finding(
                    file=b.file, line=b.start_line, end_line=b.end_line,
                    rule_id="CP-DUP-001",
                    category=Category.duplicate,
                    severity=sev,
                    confidence=Confidence.medium,
                    title=f"Duplicate code block ({lines_count} lines)",
                    message=(
                        f"Lines {b.start_line}–{b.end_line} in {b.file} are duplicated "
                        f"in {m.file} lines {m.start_line}–{m.end_line}."
                    ),
                    why_it_matters="Duplicated code increases maintenance burden — a bug fix in one copy must be applied to all.",
                    suggested_fix="Extract the duplicated logic into a shared function or module.",
                    snippet=f"Duplicate in {m.file}:{m.start_line}",
                ))

        return findings

    def clear(self) -> None:
        """Clear the entire index."""
        _file_blocks.clear()
