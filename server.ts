import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { settings } from './server/config.ts';
import { Database } from './server/db.ts';
import { Engine } from './server/engine.ts';
import { runEvaluationBenchmark } from './server/eval/benchmarkSuite.ts';
import { applyAutoFixToSource, checkLocalOllamaStatus, getRuleExplanation } from './server/explain.ts';
import { getModifiedLines, isGitAvailable, isGitRepo } from './server/gitdiff.ts';
import type { ActivityEvent, Severity } from './server/models.ts';
import { WORKSPACE_PRESETS, materializePresetWorkspace } from './server/samples/demoProjects.ts';
import { ProjectWatcher } from './server/watcher.ts';

const APP_VERSION = '1.0.0';

const db = new Database(settings.DB_PATH);
const engine = new Engine(db);
const watcher = new ProjectWatcher(settings.DEBOUNCE_MS);

let currentTargetDir: string | null = null;
let currentProjectName = 'FinPay Core Gateway';
let ollamaActive = false;
const activityFeed: ActivityEvent[] = [];

const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

function broadcastWs(event: string, data: unknown): void {
  const payload = JSON.stringify({ event, data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
      } catch {
        clients.delete(ws);
      }
    } else {
      clients.delete(ws);
    }
  }
}

function recordActivity(entry: Omit<ActivityEvent, 'id' | 'timestamp'>): ActivityEvent {
  const full: ActivityEvent = {
    ...entry,
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  };
  activityFeed.unshift(full);
  if (activityFeed.length > 50) {
    activityFeed.length = 50;
  }
  broadcastWs('activity_event', full);
  return full;
}

function isWithinWatchedRoot(candidatePath: string): boolean {
  if (!currentTargetDir) return false;
  const root = path.resolve(currentTargetDir);
  const resolved = path.resolve(candidatePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function handleSingleFileChange(
  absPath: string,
  triggerType: 'file_saved' | 'autofix' = 'file_saved',
  force = false
): ReturnType<typeof engine.getProjectReport> | null {
  if (!currentTargetDir) return null;

  const beforeProj = engine.getProjectReport(currentTargetDir, currentProjectName, false);
  const prevFileReport = beforeProj.files.find((r) => r.path === absPath);
  const prevHashRecord = db.getFileRecord(absPath);

  // If invoked by OS watcher right after an explicit API save and hash hasn't changed, skip duplicate event
  if (!force && prevHashRecord) {
    try {
      const diskText = fs.readFileSync(absPath, 'utf8');
      const prevFindingsIds = new Set(prevFileReport?.findings.map((f) => f.fingerprint) || []);
      const repCached = engine.analyzeFile(absPath, { rootDir: currentTargetDir, force: false });
      const currFindingsIds = new Set(repCached.findings.map((f) => f.fingerprint));
      if (
        diskText.length > 0 &&
        repCached.analyzed_at === prevFileReport?.analyzed_at &&
        prevFindingsIds.size === currFindingsIds.size
      ) {
        return beforeProj;
      }
    } catch {
      // Proceed to full re-analyze
    }
  }

  const inRepo = isGitRepo(currentTargetDir);
  const modLines = inRepo ? getModifiedLines(currentTargetDir, absPath) : new Set<number>();

  const prevCount = prevFileReport ? prevFileReport.findings.filter((f) => !f.dismissed).length : 0;
  const rep = engine.analyzeFile(absPath, {
    rootDir: currentTargetDir,
    force: true,
    modifiedLines: modLines,
  });
  const nextCount = rep.findings.filter((f) => !f.dismissed).length;
  const afterProj = engine.getProjectReport(currentTargetDir, currentProjectName, true);
  const deltaScore = Math.round((afterProj.score - beforeProj.score) * 10) / 10;

  broadcastWs('file_analyzed', {
    file: rep.path,
    rel_path: rep.rel_path,
    duration_ms: rep.duration_ms,
    findings_count: nextCount,
    fixed_count: Math.max(0, prevCount - nextCount),
    new_count: Math.max(0, nextCount - prevCount),
  });

  broadcastWs('score_update', {
    score: afterProj.score,
    grade: afterProj.grade,
    loc_total: afterProj.loc_total,
    counts_by_severity: afterProj.counts_by_severity,
    counts_by_category: afterProj.counts_by_category,
    delta_score: deltaScore,
  });

  recordActivity({
    type: triggerType,
    file: rep.rel_path,
    duration_ms: rep.duration_ms,
    delta_score: deltaScore,
    summary:
      triggerType === 'autofix'
        ? `Applied automated fix in ${rep.rel_path} (${rep.duration_ms} ms)`
        : `Re-analyzed ${rep.rel_path} in ${rep.duration_ms} ms (${nextCount} active issues)`,
  });

  return afterProj;
}

watcher.onChange = (filePath: string) => {
  handleSingleFileChange(filePath, 'file_saved', false);
};

watcher.onDelete = (filePath: string) => {
  if (!currentTargetDir) return;
  const beforeScore = engine.getProjectReport(currentTargetDir, currentProjectName, false).score;
  db.removeFile(filePath);
  engine.duplicateDetector.removeFile(filePath);
  const afterProj = engine.getProjectReport(currentTargetDir, currentProjectName, true);
  const delta = Math.round((afterProj.score - beforeScore) * 10) / 10;

  broadcastWs('score_update', {
    score: afterProj.score,
    grade: afterProj.grade,
    loc_total: afterProj.loc_total,
    counts_by_severity: afterProj.counts_by_severity,
    counts_by_category: afterProj.counts_by_category,
    delta_score: delta,
  });
};

function scanDirectoryIntoEngine(targetDir: string, projectName: string, seedBaselineHistory = false): void {
  const resolved = path.resolve(targetDir);
  currentTargetDir = resolved;
  currentProjectName = projectName;

  db.clearWorkspace(true);
  engine.duplicateDetector.clear();

  watcher.start(resolved);
  const inRepo = isGitRepo(resolved);

  const t0 = Date.now();
  const files = watcher.scanFiles(
    (fp) => {
      const modLines = inRepo ? getModifiedLines(resolved, fp) : new Set<number>();
      engine.analyzeFile(fp, {
        rootDir: resolved,
        force: true,
        modifiedLines: modLines,
      });
    },
    (current, total, relName) => {
      broadcastWs('scan_progress', { current, total, file: relName });
    }
  );

  // Second pass over source files so file-A in a duplicate pair also cross-references file-B if appropriate
  for (const fp of files) {
    if (/\.(?:py|js|jsx|ts|tsx)$/i.test(fp)) {
      const modLines = inRepo ? getModifiedLines(resolved, fp) : new Set<number>();
      engine.analyzeFile(fp, {
        rootDir: resolved,
        force: true,
        modifiedLines: modLines,
      });
    }
  }

  const snap = engine.getProjectReport(resolved, projectName, false);

  if (seedBaselineHistory) {
    const nowMs = Date.now();
    const baseCounts: Record<Severity, number> = { ...snap.counts_by_severity };
    // Seed 3 historical commit snapshots prior to uncommitted working tree changes
    const s1 = Math.min(100, Math.round((snap.score + 16.4) * 10) / 10);
    const s2 = Math.min(100, Math.round((snap.score + 11.2) * 10) / 10);
    const s3 = Math.min(100, Math.round((snap.score + 6.5) * 10) / 10);
    db.recordHistory(s1, baseCounts, 100, new Date(nowMs - 1000 * 60 * 45).toISOString());
    db.recordHistory(s2, baseCounts, 100, new Date(nowMs - 1000 * 60 * 30).toISOString());
    db.recordHistory(s3, baseCounts, 100, new Date(nowMs - 1000 * 60 * 12).toISOString());
  }

  const finalProj = engine.getProjectReport(resolved, projectName, true);
  const totalElapsedMs = Date.now() - t0;

  broadcastWs('score_update', {
    score: finalProj.score,
    grade: finalProj.grade,
    loc_total: finalProj.loc_total,
    counts_by_severity: finalProj.counts_by_severity,
    counts_by_category: finalProj.counts_by_category,
    delta_score: 0,
  });

  recordActivity({
    type: 'scan',
    file: projectName,
    duration_ms: totalElapsedMs,
    delta_score: 0,
    summary: `Indexed ${files.length} files (${finalProj.loc_total} LOC) in ${totalElapsedMs} ms`,
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Check local Ollama status once asynchronously
  checkLocalOllamaStatus().then((active) => {
    ollamaActive = active;
  });

  // Boot default sample workspace immediately so preview is live & rich on load
  const initialDemo = materializePresetWorkspace('fintech-gateway');
  scanDirectoryIntoEngine(initialDemo.path, initialDemo.preset.name, true);

  // --- API ROUTES ---

  app.get('/api/health', (_req, res) => {
    const hasGit = isGitAvailable();
    const inGit = currentTargetDir ? isGitRepo(currentTargetDir) : false;
    res.json({
      status: 'ok',
      version: APP_VERSION,
      js_engine: engine.jsEngineMode,
      ollama_active: ollamaActive,
      git_available: hasGit && inGit,
      watcher_running: watcher.isRunning,
      files_indexed: db.getAllReports().length,
      target_dir: currentTargetDir,
      project_name: currentProjectName,
    });
  });

  app.get('/api/presets', (_req, res) => {
    res.json({
      presets: WORKSPACE_PRESETS,
      self_scan_path: path.join(settings.ROOT_DIR, 'src'),
    });
  });

  app.post('/api/sample', (req, res) => {
    const presetId = typeof req.body?.presetId === 'string' ? req.body.presetId : 'fintech-gateway';
    const { path: demoPath, preset } = materializePresetWorkspace(presetId);
    scanDirectoryIntoEngine(demoPath, preset.name, true);
    res.json({
      status: 'ok',
      path: demoPath,
      project_name: preset.name,
      report: engine.getProjectReport(currentTargetDir, currentProjectName, false),
    });
  });

  app.post('/api/project', (req, res) => {
    try {
      // Accept both "path" and "directory" field names for compatibility
      const rawPath =
        (typeof req.body?.path === 'string' ? req.body.path.trim() : '') ||
        (typeof req.body?.directory === 'string' ? req.body.directory.trim() : '');
      if (!rawPath) {
        res.status(400).json({ detail: 'Directory path is required. Send {"path": "/absolute/path"} in the request body.' });
        return;
      }

      const resolved = path.resolve(rawPath);
      if (!fs.existsSync(resolved)) {
        res.status(400).json({ detail: 'Specified directory path does not exist on disk.' });
        return;
      }
      if (!fs.statSync(resolved).isDirectory()) {
        res.status(400).json({ detail: 'Specified path must be a directory.' });
        return;
      }

      const customName =
        typeof req.body?.name === 'string' && req.body.name.trim()
          ? req.body.name.trim()
          : path.basename(resolved) || 'Local Project';

      scanDirectoryIntoEngine(resolved, customName, false);
      res.json({
        status: 'ok',
        path: resolved,
        project_name: customName,
        report: engine.getProjectReport(currentTargetDir, currentProjectName, false),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('POST /api/project error:', message);
      res.status(500).json({ detail: `Internal error while scanning directory: ${message}` });
    }
  });

  app.get('/api/report', (_req, res) => {
    res.json(engine.getProjectReport(currentTargetDir, currentProjectName, false));
  });

  app.get('/api/activity', (_req, res) => {
    res.json(activityFeed);
  });

  app.get('/api/files', (_req, res) => {
    res.json(db.getAllReports());
  });

  app.get('/api/files/content', (req, res) => {
    const targetPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!targetPath || !isWithinWatchedRoot(targetPath)) {
      res.status(400).json({ detail: 'File must reside within the active watched workspace.' });
      return;
    }
    try {
      const content = fs.readFileSync(path.resolve(targetPath), 'utf8');
      res.json({ path: path.resolve(targetPath), content });
    } catch {
      res.status(404).json({ detail: 'Unable to read requested file.' });
    }
  });

  app.put('/api/files/content', (req, res) => {
    const targetPath = typeof req.body?.path === 'string' ? req.body.path : '';
    const content = typeof req.body?.content === 'string' ? req.body.content : null;

    if (!targetPath || content === null || !isWithinWatchedRoot(targetPath)) {
      res.status(400).json({ detail: 'Valid workspace file path and content are required.' });
      return;
    }

    try {
      const absPath = path.resolve(targetPath);
      fs.writeFileSync(absPath, content, 'utf8');
      const updatedReport = handleSingleFileChange(absPath, 'file_saved', true);
      res.json({ status: 'ok', report: updatedReport });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Write failed';
      res.status(500).json({ detail: msg });
    }
  });

  app.post('/api/findings/autofix', (req, res) => {
    const targetPath = typeof req.body?.file === 'string' ? req.body.file : '';
    const ruleId = typeof req.body?.rule_id === 'string' ? req.body.rule_id : '';
    const line = Number(req.body?.line || 0);

    if (!targetPath || !ruleId || !line || !isWithinWatchedRoot(targetPath)) {
      res.status(400).json({ detail: 'Valid file path, rule_id, and line are required.' });
      return;
    }

    try {
      const absPath = path.resolve(targetPath);
      const original = fs.readFileSync(absPath, 'utf8');
      const result = applyAutoFixToSource(original, ruleId, line);
      if (!result.applied) {
        res.status(400).json({ detail: result.description });
        return;
      }

      fs.writeFileSync(absPath, result.updated, 'utf8');
      const updatedReport = handleSingleFileChange(absPath, 'autofix', true);
      res.json({
        status: 'ok',
        description: result.description,
        content: result.updated,
        report: updatedReport,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Autofix failed';
      res.status(500).json({ detail: msg });
    }
  });

  app.get('/api/findings', (req, res) => {
    const severity = typeof req.query.severity === 'string' ? req.query.severity.toLowerCase() : null;
    const category = typeof req.query.category === 'string' ? req.query.category.toLowerCase() : null;
    const fileFilter = typeof req.query.file === 'string' ? req.query.file : null;
    const newOnly = req.query.new_only === 'true';
    const includeDismissed = req.query.include_dismissed === 'true';

    const allFindings = db.getAllReports().flatMap((r) => r.findings);
    const filtered = allFindings.filter((f) => {
      if (!includeDismissed && f.dismissed) return false;
      if (severity && f.severity !== severity) return false;
      if (category && f.category !== category) return false;
      if (fileFilter && f.file !== fileFilter) return false;
      if (newOnly && !f.is_new) return false;
      return true;
    });

    res.json(filtered);
  });

  app.post('/api/findings/:fingerprint/dismiss', (req, res) => {
    const { fingerprint } = req.params;
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Accepted risk';

    const beforeScore = engine.getProjectReport(currentTargetDir, currentProjectName, false).score;
    db.dismissFinding(fingerprint, reason);
    const proj = engine.getProjectReport(currentTargetDir, currentProjectName, true);
    const delta = Math.round((proj.score - beforeScore) * 10) / 10;

    broadcastWs('score_update', {
      score: proj.score,
      grade: proj.grade,
      loc_total: proj.loc_total,
      counts_by_severity: proj.counts_by_severity,
      counts_by_category: proj.counts_by_category,
      delta_score: delta,
    });

    recordActivity({
      type: 'dismiss',
      file: fingerprint.slice(0, 8),
      delta_score: delta,
      summary: `Dismissed finding ${fingerprint.slice(0, 8)} (${reason})`,
    });

    res.json({ status: 'ok', fingerprint, dismissed: true, report: proj });
  });

  app.post('/api/findings/:fingerprint/restore', (req, res) => {
    const { fingerprint } = req.params;
    const beforeScore = engine.getProjectReport(currentTargetDir, currentProjectName, false).score;
    db.restoreFinding(fingerprint);
    const proj = engine.getProjectReport(currentTargetDir, currentProjectName, true);
    const delta = Math.round((proj.score - beforeScore) * 10) / 10;

    broadcastWs('score_update', {
      score: proj.score,
      grade: proj.grade,
      loc_total: proj.loc_total,
      counts_by_severity: proj.counts_by_severity,
      counts_by_category: proj.counts_by_category,
      delta_score: delta,
    });

    recordActivity({
      type: 'restore',
      file: fingerprint.slice(0, 8),
      delta_score: delta,
      summary: `Restored finding ${fingerprint.slice(0, 8)} to active queue`,
    });

    res.json({ status: 'ok', fingerprint, dismissed: false, report: proj });
  });

  app.post('/api/analyze', (req, res) => {
    const targetPath = typeof req.body?.path === 'string' ? req.body.path : '';
    if (!targetPath || !isWithinWatchedRoot(targetPath) || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      res.status(400).json({ detail: 'Target file must exist within the active watched workspace.' });
      return;
    }
    const rep = engine.analyzeFile(targetPath, { rootDir: currentTargetDir || undefined, force: true });
    res.json(rep);
  });

  app.get('/api/history', (_req, res) => {
    res.json(db.getHistory());
  });

  app.get('/api/explain/:ruleId', (req, res) => {
    const guide = getRuleExplanation(req.params.ruleId);
    res.json(guide);
  });

  app.post('/api/eval/run', (_req, res) => {
    const summary = runEvaluationBenchmark();
    res.json(summary);
  });

  app.get('/api/export', (req, res) => {
    const format = req.query.format === 'md' ? 'md' : 'json';
    const proj = engine.getProjectReport(currentTargetDir, currentProjectName, false);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="codepulse_report.json"');
      res.send(JSON.stringify(proj, null, 2));
      return;
    }

    const mdLines: string[] = [
      `# CodePulse Health Report — ${proj.project_name}`,
      '',
      `**Health Score:** ${proj.score}/100 (Grade ${proj.grade})  `,
      `**Total Lines of Code:** ${proj.loc_total}  `,
      `**Workspace:** \`${proj.target_dir || 'N/A'}\`  `,
      '',
      '## Active Findings by Severity',
      '',
      '| Severity | Count |',
      '| :--- | ---: |',
    ];

    for (const [sev, count] of Object.entries(proj.counts_by_severity)) {
      mdLines.push(`| ${sev.charAt(0).toUpperCase() + sev.slice(1)} | ${count} |`);
    }

    mdLines.push('', '## Detailed Findings', '');
    const activeFindings = proj.files.flatMap((r) =>
      r.findings.filter((f) => !f.dismissed).map((f) => ({ ...f, rel_path: r.rel_path }))
    );

    if (activeFindings.length === 0) {
      mdLines.push('No active findings detected.');
    } else {
      for (const f of activeFindings) {
        mdLines.push(
          `### [${f.severity.toUpperCase()}] ${f.title} (${f.rule_id})`,
          `- **Location:** \`${f.rel_path}:${f.line}\`${f.is_new ? ' *(Uncommitted git change)*' : ''}`,
          `- **Category:** ${f.category} · **Confidence:** ${f.confidence}`,
          `- **Message:** ${f.message}`,
          `- **Why it matters:** ${f.why_it_matters}`,
          `- **Suggested fix:** ${f.suggested_fix}`,
          '```',
          f.snippet,
          '```',
          ''
        );
      }
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="codepulse_report.md"');
    res.send(mdLines.join('\n'));
  });

  // --- VITE DEV / STATIC PROD MOUNT ---
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(settings.FRONTEND_DIST);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(settings.FRONTEND_DIST));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(settings.FRONTEND_DIST, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    const proj = engine.getProjectReport(currentTargetDir, currentProjectName, false);
    ws.send(
      JSON.stringify({
        event: 'score_update',
        data: {
          score: proj.score,
          grade: proj.grade,
          loc_total: proj.loc_total,
          counts_by_severity: proj.counts_by_severity,
          counts_by_category: proj.counts_by_category,
          delta_score: 0,
        },
      })
    );

    ws.on('message', (raw) => {
      const msg = String(raw);
      if (msg === 'ping') {
        ws.send(JSON.stringify({ event: 'pong', data: {} }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  httpServer.listen(settings.PORT, '0.0.0.0', () => {
    console.log(`CodePulse server running on http://0.0.0.0:${settings.PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CodePulse server:', err);
  process.exit(1);
});
