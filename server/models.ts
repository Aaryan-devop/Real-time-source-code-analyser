import crypto from 'node:crypto';
import path from 'node:path';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Category = 'security' | 'complexity' | 'smell' | 'duplicate' | 'dependency';
export type Confidence = 'high' | 'medium' | 'low';

export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const CATEGORIES: readonly Category[] = [
  'security',
  'complexity',
  'smell',
  'duplicate',
  'dependency',
];

export interface Finding {
  id: string;
  file: string;
  line: number;
  end_line: number;
  rule_id: string;
  category: Category;
  severity: Severity;
  confidence: Confidence;
  title: string;
  message: string;
  why_it_matters: string;
  suggested_fix: string;
  snippet: string;
  fingerprint: string;
  is_new: boolean;
  dismissed: boolean;
  dismiss_reason?: string;
  can_autofix?: boolean;
}

export interface FileReport {
  path: string;
  rel_path: string;
  language: string;
  loc: number;
  findings: Finding[];
  complexity_avg: number;
  complexity_max: number;
  analyzed_at: string;
  duration_ms: number;
}

export interface HistoryPoint {
  timestamp: string;
  score: number;
  counts_by_severity: Record<Severity, number>;
}

export interface ProjectReport {
  score: number;
  grade: string;
  loc_total: number;
  counts_by_severity: Record<Severity, number>;
  counts_by_category: Record<string, number>;
  files: FileReport[];
  trend: HistoryPoint[];
  target_dir: string | null;
  project_name: string;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: 'scan' | 'file_saved' | 'autofix' | 'dismiss' | 'restore';
  file: string;
  duration_ms?: number;
  delta_score?: number;
  summary: string;
}

export function computeFingerprint(filePath: string, ruleId: string, snippet: string): string {
  const normSnippet = snippet.trim().replace(/\s+/g, ' ');
  return crypto
    .createHash('sha256')
    .update(`${filePath}:${ruleId}:${normSnippet}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

export function computeFileHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();

  if (base === 'requirements.txt' || base === 'package.json' || base === 'pyproject.toml') {
    return 'dependency';
  }
  if (ext === '.py') return 'python';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (
    ext === '.json' ||
    ext === '.toml' ||
    ext === '.txt' ||
    ext === '.md' ||
    ext === '.yaml' ||
    ext === '.yml' ||
    ext === '.env'
  ) {
    return 'config';
  }
  return 'unknown';
}
