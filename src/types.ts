export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Category = 'security' | 'complexity' | 'smell' | 'duplicate' | 'dependency';
export type Confidence = 'high' | 'medium' | 'low';

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

export interface HealthStatus {
  status: string;
  version: string;
  js_engine: string;
  ollama_active: boolean;
  git_available: boolean;
  watcher_running: boolean;
  files_indexed: number;
  target_dir: string | null;
  project_name: string;
}

export interface WorkspacePreset {
  id: string;
  name: string;
  subtitle: string;
  stack: string;
}

export interface RuleGuide {
  rule_id: string;
  cwe?: string;
  summary: string;
  risk_detail: string;
  vulnerable_example: string;
  secure_example: string;
  references: string[];
}

export interface SuiteCaseResult {
  name: string;
  suite: string;
  expectedRules: string[];
  detectedRules: string[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  redactionVerified: boolean;
  durationMs: number;
}

export interface BenchmarkSummary {
  ran_at: string;
  total_cases: number;
  precision: number;
  recall: number;
  f1_score: number;
  secret_redaction_rate: number;
  avg_file_latency_ms: number;
  cases: SuiteCaseResult[];
}

export interface ScanProgress {
  current: number;
  total: number;
  file: string;
}
