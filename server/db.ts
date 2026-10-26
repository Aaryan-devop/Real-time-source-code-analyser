import { DatabaseSync } from 'node:sqlite';
import type { Category, Confidence, FileReport, Finding, HistoryPoint, Severity } from './models.ts';

export class Database {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        rel_path TEXT NOT NULL,
        hash TEXT NOT NULL,
        language TEXT NOT NULL,
        loc INTEGER NOT NULL,
        complexity_avg REAL DEFAULT 0.0,
        complexity_max INTEGER DEFAULT 0,
        analyzed_at TEXT NOT NULL,
        duration_ms REAL DEFAULT 0.0
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        rule_id TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        confidence TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        why_it_matters TEXT NOT NULL,
        suggested_fix TEXT NOT NULL,
        snippet TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        is_new INTEGER DEFAULT 0,
        dismissed INTEGER DEFAULT 0,
        can_autofix INTEGER DEFAULT 0,
        FOREIGN KEY(file) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS dismissals (
        fingerprint TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        score REAL NOT NULL,
        counts_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_findings_file ON findings(file);
      CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);
    `);
  }

  getFileRecord(filePath: string): { path: string; hash: string; analyzed_at: string } | null {
    const row = this.db.prepare('SELECT path, hash, analyzed_at FROM files WHERE path = ?').get(filePath);
    if (!row) return null;
    return {
      path: String(row.path),
      hash: String(row.hash),
      analyzed_at: String(row.analyzed_at),
    };
  }

  getDismissals(): Record<string, string> {
    const rows = this.db.prepare('SELECT fingerprint, reason FROM dismissals').all();
    const map: Record<string, string> = {};
    for (const r of rows) {
      map[String(r.fingerprint)] = String(r.reason);
    }
    return map;
  }

  dismissFinding(fingerprint: string, reason: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT OR REPLACE INTO dismissals (fingerprint, reason, created_at) VALUES (?, ?, ?)')
      .run(fingerprint, reason, now);
    this.db.prepare('UPDATE findings SET dismissed = 1 WHERE fingerprint = ?').run(fingerprint);
  }

  restoreFinding(fingerprint: string): void {
    this.db.prepare('DELETE FROM dismissals WHERE fingerprint = ?').run(fingerprint);
    this.db.prepare('UPDATE findings SET dismissed = 0 WHERE fingerprint = ?').run(fingerprint);
  }

  saveFileReport(fileHash: string, report: FileReport): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO files
         (path, rel_path, hash, language, loc, complexity_avg, complexity_max, analyzed_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        report.path,
        report.rel_path,
        fileHash,
        report.language,
        report.loc,
        report.complexity_avg,
        report.complexity_max,
        report.analyzed_at,
        report.duration_ms
      );

    this.db.prepare('DELETE FROM findings WHERE file = ?').run(report.path);

    const insertFinding = this.db.prepare(`
      INSERT OR REPLACE INTO findings (
        id, file, line, end_line, rule_id, category, severity,
        confidence, title, message, why_it_matters, suggested_fix,
        snippet, fingerprint, is_new, dismissed, can_autofix
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const f of report.findings) {
      insertFinding.run(
        f.id,
        f.file,
        f.line,
        f.end_line,
        f.rule_id,
        f.category,
        f.severity,
        f.confidence,
        f.title,
        f.message,
        f.why_it_matters,
        f.suggested_fix,
        f.snippet,
        f.fingerprint,
        f.is_new ? 1 : 0,
        f.dismissed ? 1 : 0,
        f.can_autofix ? 1 : 0
      );
    }
  }

  removeFile(filePath: string): void {
    this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
  }

  clearWorkspace(resetHistory = false): void {
    this.db.exec('DELETE FROM findings; DELETE FROM files;');
    if (resetHistory) {
      this.db.exec('DELETE FROM history;');
    }
  }

  getAllReports(): FileReport[] {
    const dismissals = this.getDismissals();
    const fileRows = this.db.prepare('SELECT * FROM files ORDER BY rel_path ASC').all();
    const findingStmt = this.db.prepare('SELECT * FROM findings WHERE file = ? ORDER BY line ASC');

    return fileRows.map((fRow) => {
      const fPath = String(fRow.path);
      const rawFindings = findingStmt.all(fPath);
      const findings: Finding[] = rawFindings.map((r) => {
        const fp = String(r.fingerprint);
        const isDismissed = Boolean(r.dismissed) || fp in dismissals;
        return {
          id: String(r.id),
          file: String(r.file),
          line: Number(r.line),
          end_line: Number(r.end_line),
          rule_id: String(r.rule_id),
          category: String(r.category) as Category,
          severity: String(r.severity) as Severity,
          confidence: String(r.confidence) as Confidence,
          title: String(r.title),
          message: String(r.message),
          why_it_matters: String(r.why_it_matters),
          suggested_fix: String(r.suggested_fix),
          snippet: String(r.snippet),
          fingerprint: fp,
          is_new: Boolean(r.is_new),
          dismissed: isDismissed,
          dismiss_reason: dismissals[fp],
          can_autofix: Boolean(r.can_autofix),
        };
      });

      return {
        path: fPath,
        rel_path: String(fRow.rel_path),
        language: String(fRow.language),
        loc: Number(fRow.loc),
        findings,
        complexity_avg: Number(fRow.complexity_avg),
        complexity_max: Number(fRow.complexity_max),
        analyzed_at: String(fRow.analyzed_at),
        duration_ms: Number(fRow.duration_ms),
      };
    });
  }

  recordHistory(score: number, counts: Record<Severity, number>, maxRecords = 100, customTs?: string): void {
    const ts = customTs || new Date().toISOString();
    const last = this.db.prepare('SELECT score, counts_json FROM history ORDER BY id DESC LIMIT 1').get();
    const countsJson = JSON.stringify(counts);

    // Avoid spamming identical consecutive history points unless explicitly seeded
    if (!customTs && last && Number(last.score) === score && String(last.counts_json) === countsJson) {
      return;
    }

    this.db.prepare('INSERT INTO history (ts, score, counts_json) VALUES (?, ?, ?)').run(ts, score, countsJson);
    this.db
      .prepare(
        `DELETE FROM history WHERE id NOT IN (
           SELECT id FROM history ORDER BY id DESC LIMIT ?
         )`
      )
      .run(maxRecords);
  }

  getHistory(): HistoryPoint[] {
    const rows = this.db.prepare('SELECT ts, score, counts_json FROM history ORDER BY id ASC').all();
    return rows.map((r) => ({
      timestamp: String(r.ts),
      score: Number(r.score),
      counts_by_severity: JSON.parse(String(r.counts_json)) as Record<Severity, number>,
    }));
  }
}
