"""File watcher using watchdog with debounce and ignore rules.

Watches a target folder recursively. Debounces events per file (~300 ms)
so editor save bursts trigger only one analysis. Respects ignore patterns
for directories and binary/large files.

On startup: runs an initial scan of all supported files in a thread pool.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Optional

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from .config import get_settings
from .engine import LANGUAGE_MAP

log = logging.getLogger("codepulse.watcher")

# Supported file extensions
SUPPORTED_EXTENSIONS = set(LANGUAGE_MAP.keys()) | {".txt", ".json", ".toml", ".cfg", ".ini", ".md", ".yml", ".yaml"}

# Binary file extensions to always skip
BINARY_EXTENSIONS = {
    ".pyc", ".pyo", ".so", ".dll", ".exe", ".bin", ".o", ".a",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".ico", ".svg",
    ".mp3", ".mp4", ".avi", ".mov", ".wav",
    ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
    ".woff", ".woff2", ".ttf", ".eot",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".db", ".sqlite", ".sqlite3",
}


class _DebouncedHandler(FileSystemEventHandler):
    """Debounce events per file and dispatch to callback."""

    def __init__(
        self,
        on_change: Callable[[str], Any],
        on_delete: Callable[[str], Any],
        ignore_patterns: list[str],
        debounce_ms: int,
        max_file_size: int,
    ):
        self._on_change = on_change
        self._on_delete = on_delete
        self._ignore = ignore_patterns
        self._debounce_s = debounce_ms / 1000.0
        self._max_size = max_file_size
        self._timers: dict[str, threading.Timer] = {}
        self._lock = threading.Lock()

    def _should_ignore(self, path: str) -> bool:
        """Check if the path should be ignored."""
        parts = Path(path).parts
        for pattern in self._ignore:
            if pattern in parts:
                return True

        suffix = Path(path).suffix.lower()
        if suffix in BINARY_EXTENSIONS:
            return True

        if suffix not in SUPPORTED_EXTENSIONS:
            return True

        # Size check
        try:
            if os.path.isfile(path) and os.path.getsize(path) > self._max_size:
                return True
        except OSError:
            pass

        return False

    def _debounced_dispatch(self, path: str, callback: Callable) -> None:
        """Schedule a callback after the debounce period."""
        with self._lock:
            if path in self._timers:
                self._timers[path].cancel()
            timer = threading.Timer(self._debounce_s, callback, args=[path])
            timer.daemon = True
            self._timers[path] = timer
            timer.start()

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory or self._should_ignore(event.src_path):
            return
        self._debounced_dispatch(event.src_path, self._on_change)

    def on_modified(self, event: FileSystemEvent) -> None:
        if event.is_directory or self._should_ignore(event.src_path):
            return
        self._debounced_dispatch(event.src_path, self._on_change)

    def on_deleted(self, event: FileSystemEvent) -> None:
        if event.is_directory or self._should_ignore(event.src_path):
            return
        # No debounce for deletes
        self._on_delete(event.src_path)

    def on_moved(self, event: FileSystemEvent) -> None:
        # Treat as delete + create
        if not event.is_directory:
            if not self._should_ignore(event.src_path):
                self._on_delete(event.src_path)
            if hasattr(event, "dest_path") and not self._should_ignore(event.dest_path):
                self._debounced_dispatch(event.dest_path, self._on_change)


class FileWatcher:
    """Manages the watchdog observer and initial scan."""

    def __init__(
        self,
        on_change: Callable[[str], Any],
        on_delete: Callable[[str], Any],
    ):
        self._on_change = on_change
        self._on_delete = on_delete
        self._observer: Optional[Observer] = None
        self._watched_path: Optional[str] = None
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def watched_path(self) -> Optional[str]:
        return self._watched_path

    def start(self, path: str) -> None:
        """Start watching *path*."""
        self.stop()
        settings = get_settings()

        self._watched_path = str(Path(path).resolve())
        handler = _DebouncedHandler(
            on_change=self._on_change,
            on_delete=self._on_delete,
            ignore_patterns=settings.ignore_list,
            debounce_ms=settings.debounce_ms,
            max_file_size=settings.max_file_size_bytes,
        )

        self._observer = Observer()
        self._observer.schedule(handler, self._watched_path, recursive=True)
        self._observer.daemon = True
        self._observer.start()
        self._running = True
        log.info("Watcher started on %s", self._watched_path)

    def stop(self) -> None:
        """Stop the current watcher."""
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)
            self._observer = None
        self._running = False
        self._watched_path = None

    def initial_scan(self, progress_callback: Optional[Callable[[str, int, int], Any]] = None) -> list[str]:
        """Scan all supported files in the watched directory.

        Returns list of file paths. Runs on the calling thread.
        """
        if not self._watched_path:
            return []

        settings = get_settings()
        ignore = settings.ignore_list
        max_size = settings.max_file_size_bytes

        files: list[str] = []
        root = Path(self._watched_path)

        for f in root.rglob("*"):
            if f.is_dir():
                continue

            # Check ignore patterns
            parts = f.parts
            skip = False
            for pattern in ignore:
                if pattern in parts:
                    skip = True
                    break
            if skip:
                continue

            suffix = f.suffix.lower()
            if suffix in BINARY_EXTENSIONS:
                continue
            if suffix not in SUPPORTED_EXTENSIONS:
                continue

            try:
                if f.stat().st_size > max_size:
                    continue
            except OSError:
                continue

            files.append(str(f.resolve()))

        log.info("Initial scan found %d files", len(files))
        return files
