# CodePulse Module Guide

This document provides detailed information about each module in CodePulse, including responsibilities, dependencies, and usage examples.

## Table of Contents

1. [Frontend Modules](#frontend-modules)
2. [Server Modules](#server-modules)
3. [Analyzer Modules](#analyzer-modules)
4. [Utility Modules](#utility-modules)
5. [Configuration](#configuration)

---

## Frontend Modules

### src/App.tsx

**Purpose**: Root application component managing global state and routing

**Key Responsibilities**:
- WebSocket connection management with auto-reconnect
- Global state management (report, health, activity)
- View routing (overview, findings, inspector, benchmark)
- Workspace switching
- Export functionality

**State Management**:
```typescript
const [activeView, setActiveView] = useState<ActiveView>('overview')
const [report, setReport] = useState<ProjectReport>(EMPTY_REPORT)
const [health, setHealth] = useState<HealthStatus | null>(null)
const [wsConnected, setWsConnected] = useState(false)
```

**WebSocket Handling**:
- Resilient connection with exponential backoff
- Keep-alive ping every 20 seconds
- Idempotent event handling (no duplicate activities)
- Automatic state refresh on reconnect

**Dependencies**:
- All panel components
- `types.ts` for interfaces
- Lucide icons

---

### src/components/OverviewPanel.tsx

**Purpose**: Health dashboard with score, trends, and treemap

**Props**:
```typescript
interface OverviewPanelProps {
  report: ProjectReport
  lastDelta: number
  activity: ActivityEvent[]
  onSelectFile: (file: FileReport) => void
  onNavigateFindings: (severity?: Severity) => void
}
```

**Features**:
- Large health score display with grade badge
- Severity breakdown with click-to-filter
- Interactive treemap (file size by LOC, color by score)
- Historical trend chart (Recharts)
- Recent activity feed

**Treemap Interaction**:
```typescript
// Click file → open in inspector
<Treemap onClick={(data) => onSelectFile(data.fileReport)} />
```

---

### src/components/FindingsPanel.tsx

**Purpose**: Filterable, sortable list of all findings

**Props**:
```typescript
interface FindingsPanelProps {
  files: FileReport[]
  initialSeverity: string
  onInspectFinding: (finding: Finding, relPath: string) => void
  onApplyAutoFix: (finding: Finding) => Promise<void>
  onDismissFinding: (fingerprint: string, reason: string) => Promise<void>
  onRestoreFinding: (fingerprint: string) => Promise<void>
  onOpenFileAtLine: (filePath: string, line: number) => void
}
```

**Features**:
- Multi-select filters (severity, category, auto-fixable, new only)
- Sort by severity, file, line number
- Inline actions: dismiss, restore, auto-fix
- Quick navigation to source
- Shows dismissed findings with restore option

**State Management**:
```typescript
const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(new Set())
const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set())
const [showAutoFixableOnly, setShowAutoFixableOnly] = useState(false)
const [showNewOnly, setShowNewOnly] = useState(false)
```

---

### src/components/SourceInspector.tsx

**Purpose**: Code viewer with inline finding annotations

**Props**:
```typescript
interface SourceInspectorProps {
  files: FileReport[]
  selectedFilePath: string | null
  focusLine: number | null
  onSelectFilePath: (path: string) => void
  onSaveFileContent: (path: string, content: string) => Promise<void>
  onApplyAutoFix: (finding: Finding) => Promise<void>
  onInspectFinding: (finding: Finding, relPath: string) => void
}
```

**Features**:
- File tree navigation
- Syntax highlighting (basic)
- Line number display
- Inline finding badges
- Editable content with save
- Auto-scroll to focus line

**Finding Overlay**:
```typescript
{findings.map(f => (
  <FindingBadge
    line={f.line}
    severity={f.severity}
    onClick={() => onInspectFinding(f, file.rel_path)}
  />
))}
```

---

### src/components/BenchmarkPanel.tsx

**Purpose**: Rule quality validation dashboard

**Features**:
- Trigger evaluation suite (`POST /api/eval/run`)
- Display per-rule metrics (true positive, false positive rates)
- Show performance benchmarks
- Highlight failing rules

**Usage**:
```bash
# Server-side execution
npm run eval
```

---

### src/components/RuleDrawer.tsx

**Purpose**: Slide-out panel with finding details and remediation

**Props**:
```typescript
interface RuleDrawerProps {
  finding: Finding | null
  relPath: string
  onClose: () => void
  onApplyAutoFix: (finding: Finding) => Promise<void>
  onOpenInEditor: (filePath: string, line: number) => void
  onDismiss: (fingerprint: string, reason: string) => Promise<void>
}
```

**Content Sections**:
1. Rule metadata (ID, category, confidence)
2. Message and explanation
3. Why it matters (business impact)
4. Suggested fix (step-by-step)
5. Code snippet with syntax highlighting
6. Actions (auto-fix, dismiss, open in editor)

---

### src/components/CodebaseTreemap.tsx

**Purpose**: Hierarchical visualization of file health

**Algorithm**:
- Squarified treemap (Recharts)
- Size = LOC (lines of code)
- Color = health score (red → yellow → green)

**Color Mapping**:
```typescript
const getColor = (score: number) => {
  if (score >= 90) return '#10b981' // green
  if (score >= 70) return '#fbbf24' // yellow
  if (score >= 50) return '#f97316' // orange
  return '#ef4444' // red
}
```

---

### src/types.ts

**Purpose**: Shared TypeScript interfaces and types

**Key Types**:
```typescript
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
type Grade = 'A' | 'B' | 'C' | 'D' | 'F'
type ActivityType = 'scan' | 'file_saved' | 'autofix' | 'dismiss' | 'restore'

interface Finding { /* ... */ }
interface FileReport { /* ... */ }
interface ProjectReport { /* ... */ }
interface HealthStatus { /* ... */ }
interface ActivityEvent { /* ... */ }
interface ScanProgress { /* ... */ }
interface WorkspacePreset { /* ... */ }
```

---

## Server Modules

### server.ts

**Purpose**: Express application entry point

**Key Responsibilities**:
- HTTP server setup
- WebSocket server setup
- Route registration
- Vite dev server integration (development)
- Static file serving (production)
- Initial workspace load

**Startup Flow**:
```typescript
async function startServer() {
  1. Check Ollama status (AI features)
  2. Load default demo workspace
  3. Register API routes
  4. Mount Vite middleware (dev) or static (prod)
  5. Setup WebSocket upgrade handler
  6. Start HTTP server on port 5138
}
```

**WebSocket Broadcasting**:
```typescript
function broadcastWs(event: string, data: unknown): void {
  const payload = JSON.stringify({ event, data })
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  }
}
```

---

### server/engine.ts

**Purpose**: Analysis orchestration and coordination

**Class: Engine**

**Key Methods**:

```typescript
class Engine {
  // Analyze single file through all applicable analyzers
  analyzeFile(path: string, options: AnalysisOptions): FileReport

  // Generate project-level report with aggregations
  getProjectReport(dir: string, name: string, recordHistory: boolean): ProjectReport

  // Internal: merge findings from multiple analyzers
  private mergeFindings(findings: Finding[][]): Finding[]

  // Internal: apply dismissal state from database
  private applyDismissals(findings: Finding[]): Finding[]
}
```

**Analysis Pipeline**:
1. Check content hash (skip if unchanged)
2. Run language-specific analyzers
3. Run secret scanner
4. Run dependency checker (if manifest)
5. Run duplicate detector
6. Merge findings
7. Apply dismissals
8. Store in database
9. Return `FileReport`

**Analyzer Registration**:
```typescript
constructor(db: Database) {
  this.analyzers = [
    new JsAnalyzer(),
    new PyParser(),
    new PyComplexity(),
    new PySecurity(),
    new PySmells(),
    new SecretsScanner(),
    new DependencyChecker(),
  ]
  this.duplicateDetector = new DuplicateDetector()
}
```

---

### server/watcher.ts

**Purpose**: File system monitoring with debouncing

**Class: ProjectWatcher**

**Key Methods**:
```typescript
class ProjectWatcher {
  // Start watching directory recursively
  start(rootPath: string): void

  // Stop watching and cleanup
  stop(): void

  // Scan all files once (initial load)
  scanFiles(
    onFile: (path: string) => void,
    onProgress?: (current: number, total: number, name: string) => void
  ): string[]

  // Event handlers (set by consumer)
  onChange: (filePath: string) => void
  onDelete: (filePath: string) => void
}
```

**Debouncing Strategy**:
```typescript
// Per-file 300ms debounce
const timers = new Map<string, NodeJS.Timeout>()

function handleChange(filePath: string) {
  if (timers.has(filePath)) {
    clearTimeout(timers.get(filePath))
  }
  timers.set(filePath, setTimeout(() => {
    this.onChange(filePath)
    timers.delete(filePath)
  }, 300))
}
```

**Ignored Patterns**:
- `node_modules/`
- `.git/`
- `dist/`, `build/`, `out/`
- `.env*`, `.DS_Store`
- `*.min.js`, `*.map`

---

### server/db.ts

**Purpose**: SQLite data persistence layer

**Class: Database**

**Key Methods**:
```typescript
class Database {
  // File record operations
  saveFileReport(report: FileReport): void
  getFileRecord(path: string): FileRecord | null
  getAllReports(): FileReport[]
  removeFile(path: string): void

  // Finding operations
  dismissFinding(fingerprint: string, reason: string): void
  restoreFinding(fingerprint: string): void
  getDismissals(): Map<string, DismissalRecord>

  // History operations
  recordHistory(score: number, counts: SeverityCounts, loc: number, timestamp?: string): void
  getHistory(): HistorySnapshot[]

  // Workspace operations
  clearWorkspace(keepDismissals: boolean): void
}
```

**Schema**:
```sql
-- Core tables
CREATE TABLE file_reports (
  file_path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  loc INTEGER NOT NULL,
  findings TEXT NOT NULL,  -- JSON array
  analyzed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE TABLE dismissals (
  fingerprint TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  dismissed_at TEXT NOT NULL
);

CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at TEXT NOT NULL,
  score REAL NOT NULL,
  grade TEXT NOT NULL,
  counts_by_severity TEXT NOT NULL,  -- JSON
  loc_total INTEGER NOT NULL
);
```

**WAL Mode Benefits**:
- Concurrent reads don't block
- Better write performance
- Automatic checkpointing

---

### server/score.ts

**Purpose**: Health score calculation

**Function: calculateHealthScore**

```typescript
export function calculateHealthScore(
  findings: Finding[],
  totalLoc: number
): { score: number; grade: Grade }
```

**Algorithm**:
```typescript
const WEIGHTS: Record<Severity, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 0.5,
  info: 0,
}

const totalPenalty = findings
  .filter(f => !f.dismissed)
  .reduce((sum, f) => sum + WEIGHTS[f.severity], 0)

const penaltyDensity = (totalPenalty / Math.max(totalLoc, 50)) * 100
const score = Math.max(0, Math.min(100, Math.round((100 - penaltyDensity) * 10) / 10))
```

**Grade Assignment**:
```typescript
if (score >= 90) return 'A'
if (score >= 80) return 'B'
if (score >= 70) return 'C'
if (score >= 60) return 'D'
return 'F'
```

---

### server/explain.ts

**Purpose**: AI-powered explanations and auto-fix

**Key Functions**:

```typescript
// Check if local Ollama is running
export async function checkLocalOllamaStatus(): Promise<boolean>

// Get detailed rule explanation (currently static, AI planned)
export function getRuleExplanation(ruleId: string): RuleGuide

// Apply automated fix to source code
export function applyAutoFixToSource(
  content: string,
  ruleId: string,
  line: number
): { applied: boolean; updated: string; description: string }
```

**Auto-Fix Examples**:

| Rule | Fix |
|------|-----|
| `js-eval-usage` | Replace `eval()` with `JSON.parse()` |
| `py-hardcoded-secret` | Replace literal with environment variable |
| `js-console-log` | Remove console.log statement |
| `py-except-pass` | Add proper error handling |

**Future Enhancement**: Use Ollama/Gemini for custom explanations

---

### server/gitdiff.ts

**Purpose**: Git integration for change detection

**Key Functions**:

```typescript
// Check if Git is available on system
export function isGitAvailable(): boolean

// Check if directory is a Git repository
export function isGitRepo(dir: string): boolean

// Get modified line numbers compared to HEAD
export function getModifiedLines(repoRoot: string, filePath: string): Set<number>
```

**Implementation**:
```typescript
// Uses `git diff --unified=0 HEAD <file>` to get changed lines
// Parses unified diff format: @@ -old_line,old_count +new_line,new_count @@
// Returns Set of all modified line numbers
```

**Use Case**:
- Mark findings on changed lines as `is_new: true`
- Highlight uncommitted changes in UI
- Focus on recent modifications

---

### server/models.ts

**Purpose**: TypeScript domain models and interfaces

**Key Types**:
```typescript
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type Confidence = 'high' | 'medium' | 'low'
export type Category = 'security' | 'complexity' | 'duplication' | 'style' | 'performance'

export interface Finding {
  fingerprint: string
  rule_id: string
  severity: Severity
  category: Category
  title: string
  message: string
  snippet: string
  line: number
  file: string
  why_it_matters: string
  suggested_fix: string
  confidence: Confidence
  is_new: boolean
  dismissed: boolean
  dismissed_reason?: string
  auto_fixable: boolean
}

export interface AnalysisContext {
  rootDir?: string
  modifiedLines?: Set<number>
  gitAvailable?: boolean
}
```

---

### server/config.ts

**Purpose**: Application configuration

**Exports**:
```typescript
export const settings = {
  PORT: process.env.PORT || 5138,
  DB_PATH: path.join(ROOT_DIR, 'codepulse.db'),
  DEBOUNCE_MS: 300,
  ROOT_DIR: path.resolve(__dirname, '..'),
  FRONTEND_DIST: path.join(ROOT_DIR, 'dist'),
}
```

**Environment Variables**:
- `NODE_ENV`: development | production
- `PORT`: Server port (default: 5138)
- `GEMINI_API_KEY`: Optional AI features

---

## Analyzer Modules

### server/analyzers/base.ts

**Purpose**: Shared analyzer utilities and base interface

**Analyzer Interface**:
```typescript
export interface Analyzer {
  name: string
  supportedExtensions: string[]
  analyze(content: string, filePath: string, context: AnalysisContext): Finding[]
}
```

**Utility Functions**:
```typescript
// Generate deterministic fingerprint
export function generateFingerprint(path: string, ruleId: string, snippet: string): string

// Create Finding object with defaults
export function createFinding(partial: Partial<Finding>): Finding

// Redact secrets in snippet
export function redactSecret(text: string, secret: string): string
```

**Fingerprint Algorithm**:
```typescript
// SHA-256 hash of normalized content
const normalized = `${relativePath}:${ruleId}:${snippet.trim()}`
const hash = crypto.createHash('sha256').update(normalized).digest('hex')
return hash.slice(0, 16) // 16-character fingerprint
```

---

### server/analyzers/jsAnalyzer.ts

**Purpose**: JavaScript/TypeScript static analysis

**Supported Extensions**: `.js`, `.jsx`, `.ts`, `.tsx`

**Detection Rules**:

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `js-eval-usage` | Critical | Dangerous eval() call |
| `js-innerhtml-xss` | High | Potential XSS via innerHTML |
| `js-console-log` | Low | Console.log in production code |
| `js-var-declaration` | Medium | Legacy var instead of let/const |
| `js-double-equals` | Medium | Non-strict equality (==) |
| `js-empty-catch` | High | Empty catch block |
| `js-long-function` | Medium | Function exceeds 50 lines |
| `js-magic-number` | Low | Unexplained numeric literal |

**Implementation**:
```typescript
export class JsAnalyzer implements Analyzer {
  analyze(content: string, filePath: string, context: AnalysisContext): Finding[] {
    const findings: Finding[] = []
    const lines = content.split('\n')

    lines.forEach((line, idx) => {
      if (/\beval\s*\(/.test(line)) {
        findings.push(createFinding({
          rule_id: 'js-eval-usage',
          severity: 'critical',
          line: idx + 1,
          snippet: line.trim(),
          // ... other fields
        }))
      }
      // ... other checks
    })

    return findings
  }
}
```

---

### server/analyzers/pyParser.ts

**Purpose**: Python AST-based analysis

**Supported Extensions**: `.py`

**Detection Rules**:

| Rule ID | Severity | Description |
|---------|----------|-------------|
| `py-sql-injection` | Critical | String concatenation in SQL query |
| `py-hardcoded-secret` | Critical | Password/key in source code |
| `py-exec-usage` | High | Dangerous exec() call |
| `py-pickle-unsafe` | High | Unsafe pickle.loads() |
| `py-assert-usage` | Medium | Assert in production code |

**Implementation**:
Uses regex patterns (AST parsing planned):
```typescript
if (/execute\s*\(\s*[^)]*\+/.test(line)) {
  findings.push({
    rule_id: 'py-sql-injection',
    severity: 'critical',
    title: 'SQL Injection Risk',
    // ...
  })
}
```

---

### server/analyzers/pyComplexity.ts

**Purpose**: Cyclomatic complexity measurement

**Supported Extensions**: `.py`

**Detection Rules**:

| Rule ID | Severity | Threshold | Description |
|---------|----------|-----------|-------------|
| `py-high-complexity` | High | >15 | Overly complex function |
| `py-very-high-complexity` | Critical | >25 | Unmaintainable function |

**Cyclomatic Complexity Formula**:
```
CC = 1 + (number of decision points)
Decision points: if, elif, for, while, except, and, or, lambda
```

**Implementation**:
```typescript
function calculateComplexity(functionBody: string): number {
  let complexity = 1
  const patterns = [/\bif\b/, /\belif\b/, /\bfor\b/, /\bwhile\b/, /\band\b/, /\bor\b/]
  for (const pattern of patterns) {
    complexity += (functionBody.match(pattern) || []).length
  }
  return complexity
}
```

---

### server/analyzers/pySecurity.ts

**Purpose**: Python security pattern detection

**Detection Rules**:

| Rule ID | Severity | Pattern |
|---------|----------|---------|
| `py-sql-injection` | Critical | SQL concatenation |
| `py-command-injection` | Critical | `os.system()` with input |
| `py-path-traversal` | High | Unsanitized file paths |
| `py-weak-crypto` | High | MD5/SHA1 usage |
| `py-hardcoded-secret` | Critical | Password literals |

---

### server/analyzers/pySmells.ts

**Purpose**: Python code smell detection

**Detection Rules**:

| Rule ID | Severity | Threshold |
|---------|----------|-----------|
| `py-long-function` | Medium | >50 lines |
| `py-deep-nesting` | High | >4 levels |
| `py-too-many-params` | Medium | >5 parameters |
| `py-god-class` | High | >500 lines |
| `py-duplicate-code` | Medium | Flagged by duplicate detector |

---

### server/analyzers/secrets.ts

**Purpose**: Credential and API key scanning

**Supported Extensions**: All files

**Detection Patterns**:

```typescript
const SECRET_PATTERNS = [
  {
    id: 'hardcoded-aws-key',
    pattern: /AKIA[0-9A-Z]{16}/,
    severity: 'critical',
    name: 'AWS Access Key',
  },
  {
    id: 'hardcoded-github-token',
    pattern: /gh[ps]_[a-zA-Z0-9]{36}/,
    severity: 'critical',
    name: 'GitHub Token',
  },
  {
    id: 'hardcoded-private-key',
    pattern: /-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/,
    severity: 'critical',
    name: 'Private Key',
  },
  {
    id: 'hardcoded-generic-secret',
    pattern: /(password|api_key|secret_key)\s*[:=]\s*["'][^"']{8,}["']/i,
    severity: 'high',
    name: 'Generic Secret',
  },
]
```

**Redaction**:
```typescript
const redacted = match.slice(0, 4) + '***' + match.slice(-3)
finding.snippet = finding.snippet.replace(match, redacted)
```

---

### server/analyzers/dependencies.ts

**Purpose**: Known vulnerability detection in dependencies

**Supported Files**: `package.json`, `requirements.txt`, `Gemfile`, `pom.xml`

**Data Source**: `server/data/vulnerablePackages.ts` (static CVE database)

**Detection Algorithm**:
1. Parse manifest file
2. Extract package names and versions
3. Check against known vulnerabilities
4. Create Critical findings for matches

**Example**:
```typescript
{
  'lodash': [
    { version: '<4.17.21', cve: 'CVE-2020-8203', severity: 'high' }
  ],
  'axios': [
    { version: '<0.21.1', cve: 'CVE-2021-3749', severity: 'medium' }
  ]
}
```

---

### server/analyzers/duplicates.ts

**Purpose**: Copy-paste code detection

**Algorithm**: Rabin-Karp rolling hash

**Supported Extensions**: `.js`, `.jsx`, `.ts`, `.tsx`, `.py`

**Parameters**:
- Block size: 6 lines
- Minimum similarity: Exact match only
- Ignore: Comments, whitespace

**Implementation**:
```typescript
class DuplicateDetector {
  private blockHashes = new Map<string, BlockInfo[]>()

  analyze(content: string, filePath: string): Finding[] {
    const blocks = extractBlocks(content, 6) // 6-line sliding window
    const findings: Finding[] = []

    for (const block of blocks) {
      const hash = hashBlock(block.normalized)

      if (this.blockHashes.has(hash)) {
        const existingBlocks = this.blockHashes.get(hash)!
        for (const existing of existingBlocks) {
          if (existing.file !== filePath) {
            findings.push({
              rule_id: 'duplicate-code',
              severity: 'medium',
              title: 'Duplicate Code Block',
              message: `Duplicate found in ${existing.file}:${existing.line}`,
              // ...
            })
          }
        }
      }

      this.blockHashes.set(hash, [...(this.blockHashes.get(hash) || []), {
        file: filePath,
        line: block.startLine,
        content: block.normalized,
      }])
    }

    return findings
  }
}
```

---

## Utility Modules

### server/samples/demoProjects.ts

**Purpose**: Demo workspace management

**Preset Definitions**:
```typescript
export const WORKSPACE_PRESETS: WorkspacePreset[] = [
  {
    id: 'fintech-gateway',
    name: 'FinPay Core Gateway',
    stack: 'Python FastAPI + React',
    description: 'Payment processing service with intentional vulnerabilities',
  },
  {
    id: 'ml-pipeline',
    name: 'DataCo ML Pipeline',
    stack: 'Python Pandas + TensorFlow',
    description: 'Machine learning data pipeline with complexity issues',
  },
]
```

**Function: materializePresetWorkspace**

```typescript
export function materializePresetWorkspace(presetId: string): {
  path: string
  preset: WorkspacePreset
}
```

**How it works**:
1. Creates temporary directory in OS temp folder
2. Writes sample files with known issues
3. Returns path for engine to scan

**Use Case**: Demo environment for testing without real codebases

---

### server/data/vulnerablePackages.ts

**Purpose**: Static CVE database

**Structure**:
```typescript
export const VULNERABLE_PACKAGES: Record<string, VulnerabilityInfo[]> = {
  'lodash': [
    {
      minVersion: '0.0.0',
      maxVersion: '4.17.20',
      cve: 'CVE-2020-8203',
      severity: 'high',
      description: 'Prototype pollution vulnerability',
      fixVersion: '4.17.21',
    }
  ],
  // ... more packages
}
```

**Data Source**: Manually curated from:
- npm audit
- Snyk vulnerability database
- GitHub Security Advisories

**Update Process**: Quarterly manual refresh (automation planned)

---

### server/eval/benchmarkSuite.ts

**Purpose**: Analyzer quality validation

**Test Structure**:
```typescript
interface BenchmarkCase {
  name: string
  code: string
  expectedRuleIds: string[]
  expectedSeverities: Severity[]
}

const TEST_CASES: BenchmarkCase[] = [
  {
    name: 'AWS Key Detection',
    code: 'const key = "AKIAIOSFODNN7EXAMPLE"',
    expectedRuleIds: ['hardcoded-aws-key'],
    expectedSeverities: ['critical'],
  },
  // ... more cases
]
```

**Metrics**:
- True Positive: Expected finding detected
- False Negative: Expected finding missed
- False Positive: Unexpected finding detected
- Precision: TP / (TP + FP)
- Recall: TP / (TP + FN)

**Execution**:
```bash
npm run eval

# Output:
# ✓ AWS Key Detection: PASS
# ✓ SQL Injection: PASS
# ✗ XSS Detection: FAIL (expected js-innerhtml-xss, got none)
# 
# Summary: 23/25 passed (92% success rate)
```

---

### server/eval/runEval.ts

**Purpose**: Benchmark suite runner

**Function: runEvaluationBenchmark**

```typescript
export function runEvaluationBenchmark(): BenchmarkResult {
  const results: TestResult[] = []

  for (const testCase of TEST_CASES) {
    const findings = engine.analyzeFileContent(testCase.code, 'test.js')
    const detectedRules = findings.map(f => f.rule_id)

    const passed = testCase.expectedRuleIds.every(r => detectedRules.includes(r))

    results.push({
      name: testCase.name,
      passed,
      expected: testCase.expectedRuleIds,
      detected: detectedRules,
    })
  }

  return {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
  }
}
```

---

## Configuration

### package.json

**Scripts**:
```json
{
  "dev": "tsx server.ts",              // Development server with Vite HMR
  "build": "vite build",               // Production build
  "start": "node server.ts",           // Production server
  "eval": "tsx server/eval/runEval.ts", // Run benchmark suite
  "clean": "rm -rf dist server.js",     // Clean build artifacts
  "lint": "tsc --noEmit"               // Type checking
}
```

### tsconfig.json

**Key Settings**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2023", "DOM"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### vite.config.ts

**Configuration**:
```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5138,
    proxy: {
      '/api': 'http://localhost:5138',
      '/ws': {
        target: 'ws://localhost:5138',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
```

---

## Module Dependency Graph

```
┌─────────────────────────────────────────┐
│  App.tsx (Root)                         │
│  ├─ OverviewPanel                       │
│  ├─ FindingsPanel                       │
│  ├─ SourceInspector                     │
│  ├─ BenchmarkPanel                      │
│  └─ RuleDrawer                          │
└─────────────────────────────────────────┘
         ↓ HTTP/WS
┌─────────────────────────────────────────┐
│  server.ts (Express)                    │
│  ├─ Engine                              │
│  │  ├─ JsAnalyzer                       │
│  │  ├─ PyParser                         │
│  │  ├─ PyComplexity                     │
│  │  ├─ PySecurity                       │
│  │  ├─ PySmells                         │
│  │  ├─ SecretsScanner                   │
│  │  ├─ DependencyChecker                │
│  │  └─ DuplicateDetector                │
│  ├─ Database                            │
│  ├─ ProjectWatcher                      │
│  ├─ calculateHealthScore                │
│  ├─ gitdiff utilities                   │
│  └─ explain utilities                   │
└─────────────────────────────────────────┘
```

---

## Adding New Modules

### Adding a New Analyzer

1. **Create analyzer file**: `server/analyzers/newAnalyzer.ts`
2. **Implement interface**:
   ```typescript
   import { Analyzer, Finding, AnalysisContext } from './base'
   
   export class NewAnalyzer implements Analyzer {
     name = 'NewAnalyzer'
     supportedExtensions = ['.ext']
   
     analyze(content: string, filePath: string, context: AnalysisContext): Finding[] {
       // Your detection logic
       return findings
     }
   }
   ```
3. **Register in Engine**: Add to `engine.ts` constructor
4. **Add test cases**: Update `benchmarkSuite.ts`
5. **Document**: Update this file and ARCHITECTURE.md

### Adding a New Component

1. **Create component**: `src/components/NewComponent.tsx`
2. **Define props interface**:
   ```typescript
   interface NewComponentProps {
     data: SomeType
     onAction: (id: string) => void
   }
   ```
3. **Import in App.tsx**
4. **Add to routing logic**
5. **Style with Tailwind CSS**

### Adding a New API Endpoint

1. **Define route in server.ts**:
   ```typescript
   app.get('/api/new-endpoint', (req, res) => {
     // Handler logic
     res.json({ data: result })
   })
   ```
2. **Update types.ts** if new interfaces needed
3. **Add frontend consumer** in appropriate component
4. **Document** in API section

---

## Best Practices

### Frontend

- Use functional components with hooks
- Keep components under 500 lines
- Extract reusable logic to custom hooks
- Use TypeScript strict mode
- Handle loading/error states
- Optimize re-renders with `useCallback`, `useMemo`

### Backend

- Use async/await over callbacks
- Validate user input
- Handle errors gracefully
- Log important events
- Keep handlers under 100 lines
- Use early returns for validation

### Analyzers

- Focus on high-confidence patterns
- Provide clear messages
- Include actionable fixes
- Benchmark performance
- Document false positive cases
- Support incremental analysis

---

## Troubleshooting

### Common Issues

**WebSocket disconnects frequently**:
- Check firewall settings
- Increase keep-alive interval
- Verify network stability

**Analysis is slow**:
- Check file count (`find . -type f | wc -l`)
- Profile specific analyzers
- Consider incremental mode

**High false positive rate**:
- Review benchmark results (`npm run eval`)
- Adjust confidence thresholds
- Improve pattern specificity

**Database locked errors**:
- Ensure WAL mode is enabled
- Check for long-running transactions
- Increase SQLite timeout

---

**Last Updated**: 2026-10-25  
**Version**: 1.0.0
