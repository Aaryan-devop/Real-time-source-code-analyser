# CodePulse Architecture

## Overview

CodePulse is a real-time code quality analysis platform that provides static analysis, security scanning, and health metrics for software projects. It runs entirely locally with zero external telemetry, ensuring privacy and security.

**Core Value Proposition**: Continuous, privacy-first code quality monitoring with instant feedback and actionable insights.

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Layer                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  React SPA (Vite)                                    │  │
│  │  - Dashboard Views                                   │  │
│  │  - Real-time Updates (WebSocket)                     │  │
│  │  - Code Inspector                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↕ HTTP/WS
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway Layer                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Express Server                                      │  │
│  │  - REST API Endpoints                                │  │
│  │  - WebSocket Server                                  │  │
│  │  - Static Asset Serving                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                   Core Engine Layer                         │
│  ┌─────────────┬──────────────┬─────────────┬───────────┐  │
│  │   Engine    │   Watcher    │  Analyzers  │  Scoring  │  │
│  │ Coordinator │  File System │   Suite     │  Engine   │  │
│  └─────────────┴──────────────┴─────────────┴───────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                 Data Persistence Layer                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  SQLite Database (WAL mode)                          │  │
│  │  - File Records & Hashes                             │  │
│  │  - Findings & Dismissals                             │  │
│  │  - History & Trends                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
codepulse/
├── src/                          # Frontend React application
│   ├── components/               # Reusable UI components
│   │   ├── OverviewPanel.tsx    # Health dashboard
│   │   ├── FindingsPanel.tsx    # Issue list & filters
│   │   ├── SourceInspector.tsx  # Code viewer with annotations
│   │   ├── BenchmarkPanel.tsx   # Rule testing & validation
│   │   ├── RuleDrawer.tsx       # Finding detail view
│   │   ├── CodebaseTreemap.tsx  # Visual file health map
│   │   └── SeverityLabel.tsx    # UI primitives
│   ├── App.tsx                   # Root application component
│   ├── main.tsx                  # Application entry point
│   ├── types.ts                  # Shared TypeScript interfaces
│   └── index.css                 # Global styles
│
├── server/                       # Backend Node.js services
│   ├── analyzers/                # Static analysis engines
│   │   ├── base.ts              # Analyzer interface & utilities
│   │   ├── jsAnalyzer.ts        # JavaScript/TypeScript analysis
│   │   ├── pyParser.ts          # Python AST parsing
│   │   ├── pyComplexity.ts      # Cyclomatic complexity
│   │   ├── pySecurity.ts        # Python security patterns
│   │   ├── pySmells.ts          # Code smell detection
│   │   ├── secrets.ts           # Credential scanning
│   │   ├── dependencies.ts      # Vulnerability checking
│   │   └── duplicates.ts        # Clone detection
│   │
│   ├── eval/                     # Quality assurance
│   │   ├── benchmarkSuite.ts    # Rule validation tests
│   │   └── runEval.ts           # Test runner
│   │
│   ├── samples/                  # Demo workspaces
│   │   └── demoProjects.ts      # Preset configurations
│   │
│   ├── data/                     # Static reference data
│   │   └── vulnerablePackages.ts # CVE database
│   │
│   ├── config.ts                 # Application configuration
│   ├── db.ts                     # SQLite data layer
│   ├── engine.ts                 # Analysis orchestrator
│   ├── watcher.ts                # File system monitoring
│   ├── score.ts                  # Health metric calculation
│   ├── explain.ts                # AI-powered explanations
│   ├── gitdiff.ts                # Git integration
│   └── models.ts                 # TypeScript domain models
│
├── server.ts                     # Express server entry point
├── docs/                         # Documentation
│   ├── ARCHITECTURE.md          # This file
│   └── DECISIONS.md             # ADR log
│
├── vite.config.ts               # Vite bundler configuration
├── tsconfig.json                # TypeScript configuration
└── package.json                 # Dependencies & scripts
```

## Core Components

### 1. Frontend (React SPA)

**Technology**: React 19, TypeScript, Vite, Tailwind CSS

**Responsibilities**:
- Render real-time health dashboard
- Display findings with filtering and sorting
- Provide interactive code inspection
- Handle WebSocket reconnection
- Export reports (JSON/Markdown)

**Key Components**:

| Component | Purpose | State Management |
|-----------|---------|------------------|
| `App.tsx` | Root container, WebSocket client, routing | Local state (hooks) |
| `OverviewPanel` | Health score, treemap, trends | Props from parent |
| `FindingsPanel` | Filterable finding list | Local filters |
| `SourceInspector` | Code viewer with inline annotations | File selection state |
| `BenchmarkPanel` | Rule quality metrics | API fetch |
| `RuleDrawer` | Finding details & remediation | Drawer open/close |

**Data Flow**:
1. Initial load: Fetch full state via REST API
2. Live updates: WebSocket events update React state
3. User actions: POST requests trigger re-analysis

### 2. API Gateway (Express)

**Technology**: Express.js, WebSocket (ws)

**Responsibilities**:
- Serve REST API endpoints
- Maintain WebSocket connections
- Broadcast real-time events
- Serve static frontend (production)
- Proxy Vite dev server (development)

**Key Endpoints**:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/report` | Full project report |
| GET | `/api/health` | System status |
| GET | `/api/activity` | Recent events |
| POST | `/api/project` | Switch workspace |
| POST | `/api/sample` | Load demo project |
| GET | `/api/files/content` | Read file |
| PUT | `/api/files/content` | Save file |
| POST | `/api/findings/autofix` | Apply automated fix |
| POST | `/api/findings/:id/dismiss` | Dismiss finding |
| POST | `/api/findings/:id/restore` | Restore finding |
| GET | `/api/export` | Download report |
| POST | `/api/eval/run` | Run benchmark suite |
| WS | `/ws` | Real-time updates |

**WebSocket Events**:

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `score_update` | Server → Client | Score, grade, counts | Health metric change |
| `file_analyzed` | Server → Client | File path, duration, counts | Single file complete |
| `scan_progress` | Server → Client | Current, total, filename | Bulk scan progress |
| `activity_event` | Server → Client | Event object | Activity feed update |
| `ping` | Client → Server | Empty | Keep-alive |
| `pong` | Server → Client | Empty | Keep-alive response |

### 3. Analysis Engine

**Technology**: TypeScript, Node.js

**Responsibilities**:
- Coordinate multi-analyzer execution
- Manage file caching and hashing
- Compute health scores
- Track duplicate code blocks
- Integrate Git diff context

**Key Classes**:

#### `Engine` (engine.ts)
Central orchestrator that:
- Runs multiple analyzers in sequence
- Merges findings from all analyzers
- Applies dismissal state from database
- Computes project-level aggregations
- Generates trend data

**Public API**:
```typescript
class Engine {
  analyzeFile(path: string, options: AnalysisOptions): FileReport
  getProjectReport(dir: string, name: string, recordHistory: boolean): ProjectReport
}
```

#### `ProjectWatcher` (watcher.ts)
File system monitor that:
- Watches directory recursively
- Debounces burst saves (300ms)
- Filters ignored patterns (node_modules, .git, etc.)
- Triggers incremental re-analysis
- Handles file deletions

**Debouncing Strategy**:
- Per-file 300ms timeout
- Collapses editor auto-saves
- Typical re-scan: <50ms per file

#### `Database` (db.ts)
SQLite persistence layer:
- WAL mode for concurrent reads
- SHA-256 content hashing
- Finding fingerprint tracking
- Dismissal reason storage
- Historical score snapshots

**Schema** (simplified):
```sql
CREATE TABLE file_reports (
  file_path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,
  findings JSON NOT NULL
);

CREATE TABLE dismissals (
  fingerprint TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  dismissed_at TEXT NOT NULL
);

CREATE TABLE history (
  recorded_at TEXT NOT NULL,
  score REAL NOT NULL,
  counts_by_severity JSON NOT NULL,
  loc_total INTEGER NOT NULL
);
```

### 4. Analyzer Suite

All analyzers implement the `Analyzer` interface:

```typescript
interface Analyzer {
  analyze(content: string, filePath: string, context: AnalysisContext): Finding[]
}
```

#### Analyzer Inventory

| Analyzer | Languages | Detections | Performance |
|----------|-----------|------------|-------------|
| `jsAnalyzer` | JS/TS/JSX/TSX | Security, complexity, best practices | ~5ms/file |
| `pyParser` | Python | AST-based security, complexity | ~8ms/file |
| `pyComplexity` | Python | Cyclomatic complexity | ~3ms/file |
| `pySecurity` | Python | SQL injection, XSS, hardcoded secrets | ~4ms/file |
| `pySmells` | Python | Long functions, deep nesting, god classes | ~5ms/file |
| `secrets` | All | API keys, tokens, credentials | ~2ms/file |
| `dependencies` | package.json, requirements.txt | Known CVEs | ~1ms/file |
| `duplicates` | JS/TS/Python | Copy-paste detection (Rabin-Karp) | ~10ms/file |

**Execution Order**:
1. Language-specific analyzers (parallel potential)
2. Secret scanner (all files)
3. Dependency checker (manifest files)
4. Duplicate detector (after all files analyzed)

### 5. Scoring System

**Formula**:
```typescript
penalty_density = (total_penalty / max(LOC, 50)) * 100
score = clamp(round(100.0 - penalty_density, 1), 0.0, 100.0)
```

**Severity Weights**:
- Critical: 10 points
- High: 5 points
- Medium: 2 points
- Low: 0.5 points
- Info: 0 points

**Grade Mapping**:
- A: 90-100
- B: 80-89
- C: 70-79
- D: 60-69
- F: <60

**Normalization**: Per LOC to prevent large repos from having artificially low scores.

### 6. Git Integration

**Features**:
- Detect if workspace is Git repository
- Compare working tree to HEAD
- Mark new findings on modified lines
- Highlight uncommitted changes in UI

**Implementation**:
```typescript
// gitdiff.ts
export function getModifiedLines(repoRoot: string, filePath: string): Set<number>
export function isGitRepo(dir: string): boolean
export function isGitAvailable(): boolean
```

**UI Integration**:
- Badge: "Git HEAD diff active" when in repo
- Findings marked with `is_new: true` for modified lines
- Treemap highlights files with uncommitted changes

## Data Models

### Core Entities

```typescript
interface Finding {
  fingerprint: string              // SHA-256 hash (path:rule:snippet)
  rule_id: string                  // e.g., "js-eval-usage"
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string                 // e.g., "security", "complexity"
  title: string                    // Short description
  message: string                  // Detailed message
  snippet: string                  // Code excerpt
  line: number                     // Line number
  file: string                     // Absolute path
  why_it_matters: string          // Business impact
  suggested_fix: string           // Remediation guidance
  confidence: 'high' | 'medium' | 'low'
  is_new: boolean                 // On modified git lines
  dismissed: boolean
  dismissed_reason?: string
  auto_fixable: boolean
}

interface FileReport {
  path: string                     // Absolute path
  rel_path: string                // Relative to workspace
  content_hash: string            // SHA-256
  loc: number                     // Lines of code
  findings: Finding[]
  analyzed_at: string             // ISO timestamp
  duration_ms: number
}

interface ProjectReport {
  score: number                   // 0-100
  grade: string                   // A-F
  loc_total: number
  counts_by_severity: Record<Severity, number>
  counts_by_category: Record<string, number>
  files: FileReport[]
  trend: HistorySnapshot[]        // Last 10 snapshots
  target_dir: string | null
  project_name: string
}

interface ActivityEvent {
  id: string
  type: 'scan' | 'file_saved' | 'autofix' | 'dismiss' | 'restore'
  file: string
  duration_ms?: number
  delta_score: number
  summary: string
  timestamp: string
}
```

## Security & Privacy

### Privacy Guarantees

1. **No External Network Calls**: All analysis runs locally
2. **Secret Redaction**: Matched credentials are redacted before storage
3. **No Telemetry**: Zero analytics or tracking
4. **Local SQLite**: All data stays on disk

### Secret Scanning

**Detection Patterns**:
- AWS keys (AKIA...)
- GitHub tokens (ghp_, gho_, etc.)
- Private keys (BEGIN PRIVATE KEY)
- Stripe keys (sk_live_...)
- Generic secrets (password=..., api_key=...)

**Redaction**:
```typescript
// Before storage
const redacted = token.slice(0, 4) + '***' + token.slice(-3)
finding.snippet = finding.snippet.replace(token, redacted)
```

### Authentication

**Current State**: None (local desktop app)

**Future Consideration**: If multi-user or cloud version:
- OAuth2 for enterprise SSO
- API key authentication for CI/CD
- RBAC for team permissions

## Performance Characteristics

### Benchmarks (on M1 MacBook Pro)

| Operation | Time | Notes |
|-----------|------|-------|
| Single file analysis | 2-15ms | Depends on analyzers |
| Full project scan (100 files) | 800ms-2s | Parallel ready |
| Incremental re-scan | <50ms | Hash-based skipping |
| WebSocket latency | <10ms | Local network |
| SQLite write | <5ms | WAL mode |
| Duplicate detection | ~10ms/file | Second pass |

### Optimization Strategies

1. **Content Hashing**: SHA-256 hashes skip unchanged files
2. **Debouncing**: 300ms file watcher prevents duplicate scans
3. **WAL Mode**: SQLite concurrent reads don't block writes
4. **Incremental Analysis**: Only changed files re-scanned
5. **Finding Fingerprints**: Survive line drift for dismissals

### Scalability Limits

| Metric | Current Limit | Bottleneck |
|--------|---------------|------------|
| Files | ~10,000 | Memory (finding storage) |
| LOC | ~500,000 | CPU (analysis time) |
| Findings | ~50,000 | UI rendering |
| Concurrent Clients | ~100 | WebSocket connections |

**Scaling Beyond**:
- Incremental indexing (only changed files)
- Database partitioning (per-workspace)
- Web worker parallelization (browser)
- Rust analyzer rewrite (server)

## Testing Strategy

### Unit Tests (Planned)

**Analyzer Tests**:
```typescript
describe('secrets analyzer', () => {
  it('detects AWS keys', () => {
    const findings = secretsAnalyzer.analyze('const key = "AKIA..."', 'test.js')
    expect(findings[0].rule_id).toBe('hardcoded-aws-key')
    expect(findings[0].snippet).toContain('AKIA***')
  })
})
```

### Integration Tests (Planned)

**End-to-End Flow**:
1. Load sample workspace
2. Trigger file change
3. Verify WebSocket event
4. Check score update

### Benchmark Suite (Implemented)

**Location**: `server/eval/benchmarkSuite.ts`

**Purpose**: Validate analyzer accuracy

**Metrics**:
- True positive rate
- False positive rate
- Performance regression
- Rule coverage

**Execution**: `npm run eval`

## Deployment

### Development

```bash
# Terminal 1: Start dev server (Vite HMR)
npm run dev

# Terminal 2: Run evaluations (optional)
npm run eval

# Terminal 3: Type checking (optional)
npm run lint
```

**Configuration**:
- Server: http://localhost:5138
- WebSocket: ws://localhost:5138/ws
- Hot Module Replacement: Enabled
- SQLite: `codepulse.db` (auto-created)

### Production Build

```bash
# Build frontend
npm run build

# Set environment
export NODE_ENV=production

# Start production server
npm start
```

**Artifacts**:
- Frontend bundle: `dist/` (optimized, minified)
- Server: `server.ts` (transpiled via tsx)
- Database: `codepulse.db` (persistent)

### Docker Deployment (Future)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["npm", "start"]
EXPOSE 5138
```

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | `5138` | Server port |
| `GEMINI_API_KEY` | - | AI explanations (optional) |

## Future Enhancements

### Planned Features

1. **Multi-Language Support**
   - Java analyzer
   - Go analyzer
   - Ruby analyzer

2. **Advanced Git Integration**
   - PR comment integration
   - Commit hook support
   - Historical trend analysis

3. **CI/CD Integration**
   - GitHub Actions support
   - GitLab CI support
   - Quality gate enforcement

4. **Team Features**
   - Shared dismissal state
   - Team benchmarks
   - Collaborative reviews

5. **Performance**
   - Parallel analyzer execution
   - Web worker offloading
   - Incremental duplicate detection

6. **AI Features**
   - Auto-fix suggestions (via LLM)
   - Natural language queries
   - Custom rule generation

### Technical Debt

1. **Testing**: No unit/integration tests yet
2. **Error Handling**: Generic error boundaries needed
3. **Logging**: Structured logging not implemented
4. **Monitoring**: No observability instrumentation
5. **Documentation**: API documentation incomplete

## Development Guidelines

### Code Standards

- **TypeScript**: Strict mode enabled
- **Formatting**: Prettier (implicit via Vite)
- **Linting**: TypeScript compiler checks
- **Naming**: camelCase for variables, PascalCase for types

### Adding a New Analyzer

1. Create file in `server/analyzers/`
2. Implement `Analyzer` interface
3. Register in `Engine.analyzeFile()`
4. Add test cases to benchmark suite
5. Document in this file

### Adding a New API Endpoint

1. Define route in `server.ts`
2. Update type definitions
3. Add WebSocket event (if real-time)
4. Update frontend consumer
5. Test with curl/Postman

### Contributing Workflow

1. Fork repository
2. Create feature branch
3. Run evaluations: `npm run eval`
4. Type check: `npm run lint`
5. Submit pull request
6. Update DECISIONS.md for architectural changes

## References

- [DECISIONS.md](./DECISIONS.md) - Architectural Decision Records
- [package.json](../package.json) - Dependencies
- [vite.config.ts](../vite.config.ts) - Build configuration
- [server.ts](../server.ts) - API implementation
- [engine.ts](../server/engine.ts) - Analysis engine

---

**Last Updated**: 2026-10-25  
**Version**: 1.0.0  
**Maintainers**: CodePulse Team
