"""Git-aware "new issues" detection.

If the target folder is a git repo, marks findings on lines changed
since HEAD as is_new = True. Uses subprocess with safe, non-shell
invocation and a timeout.

If the folder is not a git repo or git is missing, is_new is always False.
Never crashes on git errors.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Optional

log = logging.getLogger("codepulse.gitdiff")


def is_git_available() -> bool:
    """Check if git is installed and accessible."""
    try:
        result = subprocess.run(
            ["git", "--version"],
            capture_output=True, text=True, timeout=5,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return False


def is_git_repo(folder: str) -> bool:
    """Check if *folder* is inside a git repository."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            capture_output=True, text=True, timeout=5,
            cwd=folder,
        )
        return result.returncode == 0 and result.stdout.strip() == "true"
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return False


def get_changed_lines(file_path: str, repo_root: str) -> Optional[set[int]]:
    """Return the set of line numbers changed since HEAD for *file_path*.

    Returns None if git is unavailable or the file is untracked (all lines
    are considered new for untracked files).
    """
    try:
        # Check if the file is tracked
        rel_path = str(Path(file_path).relative_to(repo_root))
        result = subprocess.run(
            ["git", "ls-files", "--error-unmatch", rel_path],
            capture_output=True, text=True, timeout=5,
            cwd=repo_root,
        )
        if result.returncode != 0:
            # Untracked file — all lines are new
            return None  # caller should mark everything as new

        # Get diff relative to HEAD
        result = subprocess.run(
            ["git", "diff", "HEAD", "--unified=0", "--", rel_path],
            capture_output=True, text=True, timeout=10,
            cwd=repo_root,
        )
        if result.returncode != 0:
            return set()

        return _parse_diff_lines(result.stdout)

    except (FileNotFoundError, subprocess.TimeoutExpired, OSError, ValueError) as exc:
        log.debug("Git diff failed for %s: %s", file_path, exc)
        return set()


def _parse_diff_lines(diff_output: str) -> set[int]:
    """Parse unified diff output to extract changed line numbers.

    Looks for @@ -old_start,old_count +new_start,new_count @@ lines.
    """
    changed: set[int] = set()
    for line in diff_output.splitlines():
        if line.startswith("@@"):
            # Parse: @@ -10,5 +12,7 @@
            parts = line.split()
            for part in parts:
                if part.startswith("+") and "," in part:
                    try:
                        start, count = part[1:].split(",")
                        start = int(start)
                        count = int(count)
                        for ln in range(start, start + count):
                            changed.add(ln)
                    except ValueError:
                        continue
                elif part.startswith("+") and part[1:].isdigit():
                    start = int(part[1:])
                    changed.add(start)
    return changed


def get_repo_root(folder: str) -> Optional[str]:
    """Return the git repo root, or None."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=5,
            cwd=folder,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass
    return None


def mark_new_findings(findings: list, file_path: str, repo_root: str | None) -> list:
    """Mark findings as is_new if they are on changed lines.

    If repo_root is None or git is unavailable, all is_new stay False.
    """
    if not repo_root or not is_git_repo(repo_root):
        return findings

    changed_lines = get_changed_lines(file_path, repo_root)

    if changed_lines is None:
        # Untracked file — everything is new
        for f in findings:
            f.is_new = True
        return findings

    for f in findings:
        if f.line in changed_lines:
            f.is_new = True

    return findings
