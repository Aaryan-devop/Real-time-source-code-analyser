"""Base analyzer interface (standalone module)."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import Finding


class Analyzer(ABC):
    """All analyzers implement this interface.

    Subclasses must set *name* and implement *analyze*.
    """

    name: str = "base"

    @abstractmethod
    def analyze(self, path: str, source: str) -> list[Finding]:
        """Analyse *source* (contents of *path*) and return a list of findings."""
        ...

    def supports(self, path: str) -> bool:
        """Return True if this analyzer should run on *path*."""
        return True
