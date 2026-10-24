"""Base analyzer interface."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import Finding


class Analyzer(ABC):
    """All analyzers implement this interface."""

    name: str = "base"

    @abstractmethod
    def analyze(self, path: str, source: str) -> list[Finding]:
        """Analyse *source* (from *path*) and return findings."""
        ...
