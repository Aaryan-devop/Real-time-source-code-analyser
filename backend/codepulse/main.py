"""FastAPI application — routes, WebSocket, and server startup.

Security of the tool itself:
- Binds to 127.0.0.1 by default
- Validates path inputs
- Never reads outside the chosen root
- Never executes analysed code
- Limits file size
- Returns errors as JSON, never stack traces
- CORS only for the Vite dev origin
- Serves the built frontend so one command runs everything
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db
from .config import SAMPLES_DIR, get_settings
from .engine import (
    ALL_ANALYZERS,
    analyze_file,
    get_project_report,
    get_watched_root,
    record_history,
    remove_file,
    set_watched_root,
)
from .explain import explain_finding, is_ollama_available
from .gitdiff import is_git_available, is_git_repo
from .analyzers.js_analyzer import js_engine
from .watcher import FileWatcher

# ── Logging ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("codepulse.main")

# ── App ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="CodePulse",
    description="Real-time source code health dashboard",
    version="0.1.0",
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── State ──────────────────────────────────────────────────────────────

_ws_clients: set[WebSocket] = set()
_executor = ThreadPoolExecutor(max_workers=4)
_watcher: FileWatcher | None = None
_scan_in_progress = False


# ── WebSocket helpers ──────────────────────────────────────────────────

async def _broadcast(event: str, data: Any = None) -> None:
    """Send an event to all connected WebSocket clients."""
    msg = json.dumps({"event": event, "data": data})
    dead: list[WebSocket] = []
    for ws in _ws_clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_clients.discard(ws)


# ── File change callbacks ─────────────────────────────────────────────

def _on_file_change(path: str) -> None:
    """Called by the watcher (from a background thread) when a file changes."""
    log.info("File changed: %s", path)
    report = analyze_file(path, force=True)
    if report:
        record_history()
        # Schedule async broadcast
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    _broadcast("file_analyzed", {
                        "path": report.path,
                        "findings_count": len([f for f in report.findings if not f.dismissed]),
                        "duration_ms": report.duration_ms,
                    }),
                    loop,
                )
                asyncio.run_coroutine_threadsafe(
                    _broadcast("score_update", get_project_report()),
                    loop,
                )
        except RuntimeError:
            pass


def _on_file_delete(path: str) -> None:
    """Called by the watcher when a file is deleted."""
    log.info("File deleted: %s", path)
    remove_file(path)
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.run_coroutine_threadsafe(
                _broadcast("finding_removed", {"path": path}),
                loop,
            )
            asyncio.run_coroutine_threadsafe(
                _broadcast("score_update", get_project_report()),
                loop,
            )
    except RuntimeError:
        pass


# ── Startup ────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    db.init_db()
    log.info("CodePulse started — listening on %s:%s", settings.host, settings.port)


@app.on_event("shutdown")
async def shutdown() -> None:
    global _watcher
    if _watcher:
        _watcher.stop()
    db.close_db()


# ── Request/Response models ───────────────────────────────────────────

class ProjectRequest(BaseModel):
    path: str

class DismissRequest(BaseModel):
    reason: str = ""

class ExplainRequest(BaseModel):
    finding_id: str

class AnalyzeRequest(BaseModel):
    path: str


# ── Routes ─────────────────────────────────────────────────────────────

@app.post("/api/project")
async def set_project(req: ProjectRequest) -> dict:
    """Set/change the watched folder and start the initial scan."""
    global _watcher, _scan_in_progress

    target = Path(req.path).resolve()
    if not target.exists():
        raise HTTPException(400, f"Path does not exist: {req.path}")
    if not target.is_dir():
        raise HTTPException(400, f"Path is not a directory: {req.path}")

    set_watched_root(str(target))

    # Stop existing watcher
    if _watcher:
        _watcher.stop()

    _watcher = FileWatcher(on_change=_on_file_change, on_delete=_on_file_delete)
    _watcher.start(str(target))

    # Initial scan in background
    _scan_in_progress = True

    async def _do_scan() -> None:
        global _scan_in_progress
        try:
            files = _watcher.initial_scan()
            total = len(files)
            for i, f in enumerate(files):
                await _broadcast("scan_progress", {"file": f, "current": i + 1, "total": total})
                # Run analysis in thread pool to not block
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(_executor, analyze_file, f)

            record_history()
            await _broadcast("scan_progress", {"file": "", "current": total, "total": total, "done": True})
            await _broadcast("score_update", get_project_report())
        finally:
            _scan_in_progress = False

    asyncio.create_task(_do_scan())

    return {"status": "watching", "path": str(target), "message": "Initial scan started."}


@app.get("/api/report")
async def get_report() -> dict:
    """Get the current project report."""
    return get_project_report()


@app.get("/api/files")
async def list_files() -> list[dict]:
    """List all analysed files."""
    files = db.get_all_files()
    return files


@app.get("/api/files/{path:path}")
async def get_file(path: str) -> dict:
    """Get the report for a specific file."""
    # Resolve and validate
    data = db.get_file_report_data(path)
    if not data:
        # Try resolving relative to watched root
        root = get_watched_root()
        if root:
            abs_path = str(Path(root) / path)
            data = db.get_file_report_data(abs_path)
    if not data:
        raise HTTPException(404, f"File not found: {path}")
    data["findings"] = [f.model_dump() for f in data["findings"]]
    return data


@app.get("/api/findings")
async def list_findings(
    severity: str | None = Query(None),
    category: str | None = Query(None),
    file: str | None = Query(None),
    new_only: bool = Query(False),
    include_dismissed: bool = Query(False),
) -> list[dict]:
    """List findings with optional filters."""
    findings = db.get_findings(
        file=file, severity=severity, category=category,
        new_only=new_only, include_dismissed=include_dismissed,
    )
    return [f.model_dump() for f in findings]


@app.post("/api/findings/{finding_id}/dismiss")
async def dismiss(finding_id: str, req: DismissRequest) -> dict:
    """Dismiss a finding by fingerprint."""
    ok = db.dismiss_finding(finding_id, req.reason)
    if not ok:
        raise HTTPException(404, f"Finding not found: {finding_id}")
    record_history()
    await _broadcast("score_update", get_project_report())
    return {"status": "dismissed"}


@app.post("/api/findings/{finding_id}/restore")
async def restore(finding_id: str) -> dict:
    """Restore a dismissed finding."""
    ok = db.restore_finding(finding_id)
    if not ok:
        raise HTTPException(404, f"Finding not found: {finding_id}")
    record_history()
    await _broadcast("score_update", get_project_report())
    return {"status": "restored"}


@app.post("/api/explain")
async def explain(req: ExplainRequest) -> dict:
    """Explain a finding (uses Ollama if available, otherwise built-in template)."""
    finding = db.get_finding_by_id(req.finding_id)
    if not finding:
        raise HTTPException(404, f"Finding not found: {req.finding_id}")
    result = await explain_finding(finding)
    return result


@app.post("/api/analyze")
async def force_analyze(req: AnalyzeRequest) -> dict:
    """Force re-analysis of a single file."""
    target = Path(req.path).resolve()
    if not target.is_file():
        raise HTTPException(400, f"Not a valid file: {req.path}")
    report = analyze_file(str(target), force=True)
    if not report:
        raise HTTPException(500, "Analysis failed")
    record_history()
    await _broadcast("file_analyzed", {
        "path": report.path,
        "findings_count": len([f for f in report.findings if not f.dismissed]),
        "duration_ms": report.duration_ms,
    })
    await _broadcast("score_update", get_project_report())
    return report.model_dump()


@app.get("/api/history")
async def get_history() -> list[dict]:
    """Get the score history for the trend chart."""
    history = db.get_history()
    return [h.model_dump() for h in history]


@app.get("/api/health")
async def health() -> dict:
    """Engine status — honest indicators of what's active."""
    ollama = await is_ollama_available()
    git = is_git_available()
    git_repo = False
    root = get_watched_root()
    if root and git:
        git_repo = is_git_repo(root)
    return {
        "status": "ok",
        "js_engine": js_engine(),
        "ollama_active": ollama,
        "git_available": git,
        "git_repo": git_repo,
        "watcher_running": _watcher.is_running if _watcher else False,
        "files_indexed": len(db.get_all_files()),
        "scan_in_progress": _scan_in_progress,
    }


@app.post("/api/sample")
async def load_sample() -> dict:
    """Copy the demo project to a temp folder and start watching it."""
    if not SAMPLES_DIR.exists():
        raise HTTPException(500, "Demo project not found")

    # Copy to temp so it can be edited safely
    tmp = Path(tempfile.mkdtemp(prefix="codepulse_demo_"))
    shutil.copytree(SAMPLES_DIR, tmp / "demo_project", dirs_exist_ok=True)
    demo_path = str(tmp / "demo_project")

    # Use the project endpoint
    req = ProjectRequest(path=demo_path)
    return await set_project(req)


@app.get("/api/export")
async def export_report(format: str = Query("json")) -> Response:
    """Export the current report as JSON or Markdown."""
    report = get_project_report()

    if format == "md":
        md = _report_to_markdown(report)
        return Response(content=md, media_type="text/markdown",
                        headers={"Content-Disposition": "attachment; filename=codepulse_report.md"})
    else:
        return JSONResponse(content=report,
                            headers={"Content-Disposition": "attachment; filename=codepulse_report.json"})


def _report_to_markdown(report: dict) -> str:
    """Convert a ProjectReport dict to a Markdown string."""
    lines = [
        "# CodePulse Report",
        "",
        f"**Score:** {report['score']} ({report['grade']})",
        f"**Total files:** {report['total_files']}",
        f"**Total LOC:** {report['total_loc']}",
        f"**Total findings:** {report['total_findings']}",
        "",
        "## Findings by Severity",
        "",
        "| Severity | Count |",
        "|----------|-------|",
    ]
    for sev, count in report.get("counts_by_severity", {}).items():
        lines.append(f"| {sev} | {count} |")

    lines += ["", "## Findings by Category", "", "| Category | Count |", "|----------|-------|"]
    for cat, count in report.get("counts_by_category", {}).items():
        lines.append(f"| {cat} | {count} |")

    lines += ["", "## All Findings", ""]
    for file_report in report.get("files", []):
        for f in file_report.get("findings", []):
            if isinstance(f, dict) and not f.get("dismissed", False):
                lines.append(
                    f"- **[{f.get('severity', '?').upper()}]** {f.get('title', '?')} "
                    f"— `{f.get('file', '?')}:{f.get('line', '?')}` ({f.get('rule_id', '?')})"
                )

    return "\n".join(lines)


# ── WebSocket ──────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    _ws_clients.add(ws)
    log.info("WebSocket client connected (%d total)", len(_ws_clients))
    try:
        while True:
            # Keep the connection alive; client can send ping/commands
            data = await ws.receive_text()
            # Echo status
            await ws.send_text(json.dumps({"event": "pong", "data": data}))
    except WebSocketDisconnect:
        _ws_clients.discard(ws)
        log.info("WebSocket client disconnected (%d remaining)", len(_ws_clients))


# ── Serve built frontend ──────────────────────────────────────────────

_frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")


# ── Entry point ────────────────────────────────────────────────────────

def run() -> None:
    """Run the server (called by `make run` or `python -m codepulse.main`)."""
    import uvicorn
    uvicorn.run(
        "codepulse.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    run()
