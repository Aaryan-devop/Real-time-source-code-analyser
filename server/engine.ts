import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { BaseAnalyzer } from './analyzers/base.ts';
import { DependencyAnalyzer } from './analyzers/dependencies.ts';
import { DuplicateDetector } from './analyzers/duplicates.ts';
import { JavaScriptAnalyzer } from './analyzers/jsAnalyzer.ts';
import { PythonComplexityAnalyzer } from './analyzers/pyComplexity.ts';
import { checkPythonSyntax } from './analyzers/pyParser.ts';
import { PythonSecurityAnalyzer } from './analyzers/pySecurity.ts';
import { PythonSmellsAnalyzer } from './analyzers/pySmells.ts';
import { SecretsAnalyzer } from './analyzers/secrets.ts';
import type { Database } from './db.ts';
import { computeFileHash, computeFingerprint, detectLanguage } from './models.ts';
import type { FileReport, Finding, ProjectReport } from './models.ts';
import { calculateHealthScore } from './score.ts';

export class Engine {
  readonly db: Database;
  readonly analyzers: BaseAnalyzer[] = [];
  readonly jsAnalyzer = new JavaScriptAnalyzer();
  readonly duplicateDetector = new DuplicateDetector();
  readonly dependencyAnalyzer = new DependencyAnalyzer();

  constructor(db: Database) {
    this.db = db;
    this.registerDefaultAnalyzers();
  }

  private registerDefaultAnalyzers(): void {
    this.registerAnalyzer(new PythonComplexityAnalyzer());
    this.registerAnalyzer(new PythonSmellsAnalyzer());
    this.registerAnalyzer(new PythonSecurityAnalyzer());
    this.registerAnalyzer(new SecretsAnalyzer());
    this.registerAnalyzer(this.jsAnalyzer);
    this.registerAnalyzer(this.duplicateDetector);
    this.registerAnalyzer(this.dependencyAnalyzer);
  }

  registerAnalyzer(analyzer: BaseAnalyzer): void {
    this.analyzers.push(analyzer);
  }

  get jsEngineMode(): string {
    return this.jsAnalyzer.engineMode;
  }

  analyzeSourceInMemory(virtualPath: string, content: string): FileReport {
    const start = performance.now();
    const nowIso = new Date().toISOString();
    const language = detectLanguage(virtualPath);
    const lines = content.split(/\r?\n/);
    const loc = lines.length;

    if (language === 'python') {
      const synErr = checkPythonSyntax(content);
      if (synErr) {
        const snip = lines[synErr.line - 1] || '';
        return {
          path: virtualPath,
          rel_path: virtualPath,
          language,
          loc,
          findings: [
            {
              id: `syn-err-${synErr.line}`,
              file: virtualPath,
              line: synErr.line,
              end_line: synErr.line,
              rule_id: 'CP-SYN-001',
              category: 'smell',
              severity: 'medium',
              confidence: 'high',
              title: 'Syntax Error',
              message: `Python syntax error at line ${synErr.line}: ${synErr.message}`,
              why_it_matters: 'Invalid syntax prevents parsing, testing, and execution.',
              suggested_fix: 'Correct the syntax error on the indicated line.',
              snippet: snip,
              fingerprint: computeFingerprint(virtualPath, 'CP-SYN-001', snip),
              is_new: false,
              dismissed: false,
            },
          ],
          complexity_avg: 0,
          complexity_max: 0,
          analyzed_at: nowIso,
          duration_ms: Math.round((performance.now() - start) * 100) / 100,
        };
      }
    }

    const findings: Finding[] = [];
    const compScores: number[] = [];

    for (const analyzer of this.analyzers) {
      if (!analyzer.supports(language, virtualPath)) continue;
      try {
        const res = analyzer.analyze(virtualPath, content);
        if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && Array.isArray(res[1])) {
          findings.push(...res[0]);
          compScores.push(...res[1]);
        } else {
          findings.push(...(res as Finding[]));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        findings.push({
          id: `analyzer-err-${Date.now()}`,
          file: virtualPath,
          line: 1,
          end_line: 1,
          rule_id: 'CP-ENGINE-ERR',
          category: 'smell',
          severity: 'info',
          confidence: 'low',
          title: 'Analyzer Execution Error',
          message: `Analyzer ${analyzer.name} failed safely: ${msg}`,
          why_it_matters: 'An isolated rule encountered an unexpected input structure.',
          suggested_fix: 'Inspect file encoding or syntax.',
          snippet: '',
          fingerprint: computeFingerprint(virtualPath, 'CP-ENGINE-ERR', msg),
          is_new: false,
          dismissed: false,
        });
      }
    }

    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    const avgComp =
      compScores.length > 0
        ? Math.round((compScores.reduce((a, b) => a + b, 0) / compScores.length) * 100) / 100
        : 0;
    const maxComp = compScores.length > 0 ? Math.max(...compScores) : 0;

    return {
      path: virtualPath,
      rel_path: virtualPath,
      language,
      loc,
      findings,
      complexity_avg: avgComp,
      complexity_max: maxComp,
      analyzed_at: nowIso,
      duration_ms: durationMs,
    };
  }

  analyzeFile(
    filePath: string,
    options: {
      rootDir?: string;
      force?: boolean;
      modifiedLines?: Set<number>;
    } = {}
  ): FileReport {
    const start = performance.now();
    const nowIso = new Date().toISOString();
    const absPath = path.resolve(filePath);
    const relPath = options.rootDir
      ? path.relative(path.resolve(options.rootDir), absPath).split(path.sep).join('/')
      : path.basename(absPath);

    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        path: absPath,
        rel_path: relPath,
        language: 'unknown',
        loc: 0,
        findings: [
          {
            id: `io-err-${Date.now()}`,
            file: absPath,
            line: 1,
            end_line: 1,
            rule_id: 'CP-IO-001',
            category: 'smell',
            severity: 'info',
            confidence: 'high',
            title: 'File Read Error',
            message: msg,
            why_it_matters: 'Target file could not be read from disk.',
            suggested_fix: 'Verify file permissions and UTF-8 encoding.',
            snippet: '',
            fingerprint: computeFingerprint(relPath, 'CP-IO-001', msg),
            is_new: false,
            dismissed: false,
          },
        ],
        complexity_avg: 0,
        complexity_max: 0,
        analyzed_at: nowIso,
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
      };
    }

    const fileHash = computeFileHash(content);

    // Incremental SHA-256 cache check
    if (!options.force) {
      const cached = this.db.getFileRecord(absPath);
      if (cached && cached.hash === fileHash) {
        const existing = this.db.getAllReports().find((r) => r.path === absPath);
        if (existing) return existing;
      }
    }

    const memReport = this.analyzeSourceInMemory(absPath, content);
    const dismissals = this.db.getDismissals();

    for (const f of memReport.findings) {
      // Re-key fingerprint against relative path so moving workspace roots keeps stable fingerprints
      f.fingerprint = computeFingerprint(relPath, f.rule_id, f.snippet);
      if (f.fingerprint in dismissals) {
        f.dismissed = true;
        f.dismiss_reason = dismissals[f.fingerprint];
      }
      if (options.modifiedLines && options.modifiedLines.has(f.line)) {
        f.is_new = true;
      }
    }

    const finalReport: FileReport = {
      ...memReport,
      path: absPath,
      rel_path: relPath,
      duration_ms: Math.round((performance.now() - start) * 100) / 100,
    };

    this.db.saveFileReport(fileHash, finalReport);
    return finalReport;
  }

  getProjectReport(targetDir: string | null, projectName: string, recordPoint = true): ProjectReport {
    const reports = this.db.getAllReports();
    const totalLoc = reports.reduce((acc, r) => acc + r.loc, 0);
    const allFindings = reports.flatMap((r) => r.findings);

    const { score, grade, countsBySeverity, countsByCategory } = calculateHealthScore(allFindings, totalLoc);
    if (recordPoint && reports.length > 0) {
      this.db.recordHistory(score, countsBySeverity);
    }
    const trend = this.db.getHistory();

    return {
      score,
      grade,
      loc_total: totalLoc,
      counts_by_severity: countsBySeverity,
      counts_by_category: countsByCategory,
      files: reports,
      trend,
      target_dir: targetDir,
      project_name: projectName,
    };
  }
}
