"""SQLite persistence layer for CodePulse (WAL mode).

Tables
------
- files(path, hash, language, loc, analyzed_at)
- findings(…)
- dismissals(fingerprint, reason, created_at)
- history(ts, score, counts_json)
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .models import Category, Confidence, Finding, Severity, TrendPoint

log = logging.getLogger("codepulse.db")

_DB_PATH: Path | None = None
_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    """Return a thread-local connection (SQLite is not thread-safe by default)."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        if _DB_PATH is None:
            raise RuntimeError("Database not initialised — call init_db first")
        conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.row_factory = sqlite3.Row
        _local.conn = conn
    return conn


def init_db(db_path: Path | str | None = None) -> None:
    """Create tables if they don't exist."""
    global _DB_PATH
    if db_path is None:
        db_path = Path(__file__).resolve().parent.parent / "codepulse.db"
    _DB_PATH = Path(db_path)

    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS files (
            path       TEXT PRIMARY KEY,
            hash       TEXT NOT NULL,
            language   TEXT NOT NULL DEFAULT 'unknown',
            loc        INTEGER NOT NULL DEFAULT 0,
            analyzed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS findings (
            id           TEXT PRIMARY KEY,
            file         TEXT NOT NULL,
            line         INTEGER NOT NULL,
            end_line     INTEGER,
            rule_id      TEXT NOT NULL,
            category     TEXT NOT NULL,
            severity     TEXT NOT NULL,
            confidence   TEXT NOT NULL DEFAULT 'high',
            title        TEXT NOT NULL,
            message      TEXT NOT NULL,
            why_it_matters TEXT DEFAULT '',
            suggested_fix  TEXT DEFAULT '',
            snippet      TEXT DEFAULT '',
            fingerprint  TEXT NOT NULL,
            is_new       INTEGER NOT NULL DEFAULT 0,
            dismissed    INTEGER NOT NULL DEFAULT 0,
            dismissed_reason TEXT,
            cwe          TEXT,
            FOREIGN KEY(file) REFERENCES files(path) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_findings_file ON findings(file);
        CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);

        CREATE TABLE IF NOT EXISTS dismissals (
            fingerprint TEXT PRIMARY KEY,
            reason      TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS history (
            ts          TEXT PRIMARY KEY,
            score       REAL NOT NULL,
            counts_json TEXT NOT NULL
        );
    """)
    conn.commit()
    log.info("Database initialised at %s", _DB_PATH)


# ── File CRUD ──────────────────────────────────────────────────────────

def upsert_file(path: str, content_hash: str, language: str, loc: int) -> None:
    conn = _get_conn()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO files(path, hash, language, loc, analyzed_at) VALUES (?,?,?,?,?) "
        "ON CONFLICT(path) DO UPDATE SET hash=excluded.hash, language=excluded.language, "
        "loc=excluded.loc, analyzed_at=excluded.analyzed_at",
        (path, content_hash, language, loc, now),
    )
    conn.commit()


def get_file_hash(path: str) -> Optional[str]:
    conn = _get_conn()
    row = conn.execute("SELECT hash FROM files WHERE path=?", (path,)).fetchone()
    return row["hash"] if row else None


def delete_file(path: str) -> None:
    conn = _get_conn()
    conn.execute("DELETE FROM findings WHERE file=?", (path,))
    conn.execute("DELETE FROM files WHERE path=?", (path,))
    conn.commit()


def get_all_files() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM files").fetchall()
    return [dict(r) for r in rows]


# ── Findings CRUD ──────────────────────────────────────────────────────

def save_findings(file_path: str, findings: list[Finding]) -> None:
    """Replace all findings for *file_path* with the new list."""
    conn = _get_conn()
    conn.execute("DELETE FROM findings WHERE file=?", (file_path,))
    for f in findings:
        conn.execute(
            "INSERT INTO findings(id,file,line,end_line,rule_id,category,severity,"
            "confidence,title,message,why_it_matters,suggested_fix,snippet,"
            "fingerprint,is_new,dismissed,dismissed_reason,cwe) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                f.id, f.file, f.line, f.end_line, f.rule_id,
                f.category.value, f.severity.value, f.confidence.value,
                f.title, f.message, f.why_it_matters, f.suggested_fix,
                f.snippet, f.fingerprint, int(f.is_new), int(f.dismissed),
                f.dismissed_reason, f.cwe,
            ),
        )
    conn.commit()


def get_findings(
    file: str | None = None,
    severity: str | None = None,
    category: str | None = None,
    new_only: bool = False,
    include_dismissed: bool = False,
) -> list[Finding]:
    conn = _get_conn()
    sql = "SELECT * FROM findings WHERE 1=1"
    params: list = []
    if file:
        sql += " AND file=?"
        params.append(file)
    if severity:
        sql += " AND severity=?"
        params.append(severity)
    if category:
        sql += " AND category=?"
        params.append(category)
    if new_only:
        sql += " AND is_new=1"
    if not include_dismissed:
        sql += " AND dismissed=0"
    rows = conn.execute(sql, params).fetchall()
    return [_row_to_finding(r) for r in rows]


def get_finding_by_id(finding_id: str) -> Optional[Finding]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM findings WHERE id=?", (finding_id,)).fetchone()
    return _row_to_finding(row) if row else None


def _row_to_finding(row: sqlite3.Row) -> Finding:
    d = dict(row)
    d["is_new"] = bool(d["is_new"])
    d["dismissed"] = bool(d["dismissed"])
    d["category"] = Category(d["category"])
    d["severity"] = Severity(d["severity"])
    d["confidence"] = Confidence(d["confidence"])
    return Finding(**d)


# ── Dismissals ─────────────────────────────────────────────────────────

def dismiss_finding(finding_id: str, reason: str = "") -> bool:
    conn = _get_conn()
    row = conn.execute("SELECT fingerprint FROM findings WHERE id=?", (finding_id,)).fetchone()
    if not row:
        return False
    fp = row["fingerprint"]
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO dismissals(fingerprint, reason, created_at) VALUES (?,?,?) "
        "ON CONFLICT(fingerprint) DO UPDATE SET reason=excluded.reason",
        (fp, reason, now),
    )
    conn.execute("UPDATE findings SET dismissed=1, dismissed_reason=? WHERE fingerprint=?", (reason, fp))
    conn.commit()
    return True


def restore_finding(finding_id: str) -> bool:
    conn = _get_conn()
    row = conn.execute("SELECT fingerprint FROM findings WHERE id=?", (finding_id,)).fetchone()
    if not row:
        return False
    fp = row["fingerprint"]
    conn.execute("DELETE FROM dismissals WHERE fingerprint=?", (fp,))
    conn.execute("UPDATE findings SET dismissed=0, dismissed_reason=NULL WHERE fingerprint=?", (fp,))
    conn.commit()
    return True


def get_dismissed_fingerprints() -> set[str]:
    conn = _get_conn()
    rows = conn.execute("SELECT fingerprint FROM dismissals").fetchall()
    return {r["fingerprint"] for r in rows}


def apply_dismissals(findings: list[Finding]) -> list[Finding]:
    """Mark findings that have been previously dismissed."""
    dismissed = get_dismissed_fingerprints()
    for f in findings:
        if f.fingerprint in dismissed:
            f.dismissed = True
    return findings


# ── History ────────────────────────────────────────────────────────────

def add_history_point(score: float, counts: dict[str, int], max_points: int = 500) -> None:
    conn = _get_conn()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO history(ts, score, counts_json) VALUES (?,?,?)",
        (now, score, json.dumps(counts)),
    )
    # Trim old points
    total = conn.execute("SELECT COUNT(*) as c FROM history").fetchone()["c"]
    if total > max_points:
        conn.execute(
            "DELETE FROM history WHERE ts IN "
            "(SELECT ts FROM history ORDER BY ts ASC LIMIT ?)",
            (total - max_points,),
        )
    conn.commit()


def get_history() -> list[TrendPoint]:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM history ORDER BY ts ASC").fetchall()
    return [
        TrendPoint(ts=r["ts"], score=r["score"], counts=json.loads(r["counts_json"]))
        for r in rows
    ]


# ── Helpers ────────────────────────────────────────────────────────────

def close_db() -> None:
    conn = getattr(_local, "conn", None)
    if conn:
        conn.close()
        _local.conn = None


def get_file_report_data(path: str) -> dict | None:
    """Return raw file data plus its findings for building a FileReport."""
    conn = _get_conn()
    frow = conn.execute("SELECT * FROM files WHERE path=?", (path,)).fetchone()
    if not frow:
        return None
    findings = get_findings(file=path, include_dismissed=True)
    return {
        "path": frow["path"],
        "language": frow["language"],
        "loc": frow["loc"],
        "analyzed_at": frow["analyzed_at"],
        "findings": findings,
    }
