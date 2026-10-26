# CodePulse Folder Structure & Organization

## Current Structure

```
codepulse/
├── .claude/                      # Claude Code configuration
│   └── .cc-writes/              # Internal Claude Code state
│
├── docs/                         # Documentation
│   ├── ARCHITECTURE.md          # System architecture overview
│   ├── DECISIONS.md             # Architectural Decision Records (ADR)
│   ├── MODULE_GUIDE.md          # Module-by-module documentation
│   └── FOLDER_STRUCTURE.md      # This file
│
├── server/                       # Backend services
│   ├── analyzers/               # Static analysis engines
│   │   ├── base.ts             # Analyzer interface & utilities
│   │   ├── jsAnalyzer.ts       # JavaScript/TypeScript analyzer
│   │   ├── pyParser.ts         # Python AST parser
│   │   ├── pyComplexity.ts     # Cyclomatic complexity analyzer
│   │   ├── pySecurity.ts       # Python security patterns
│   │   ├── pySmells.ts         # Code smell detection
│   │   ├── secrets.ts          # Credential scanner
│   │   ├── dependencies.ts     # Vulnerability checker
│   │   └── duplicates.ts       # Clone detection
│   │
│   ├── data/                    # Static reference data
│   │   └── vulnerablePackages.ts # CVE database
│   │
│   ├── eval/                    # Quality assurance
│   │   ├── benchmarkSuite.ts   # Rule validation tests
│   │   └── runEval.ts          # Test runner
│   │
│   ├── samples/                 # Demo workspaces
│   │   └── demoProjects.ts     # Preset configurations
│   │
│   ├── config.ts                # Application configuration
│   ├── db.ts                    # SQLite data layer
│   ├── engine.ts                # Analysis orchestrator
│   ├── explain.ts               # AI-powered explanations
│   ├── gitdiff.ts               # Git integration
│   ├── models.ts                # Domain models & interfaces
│   ├── score.ts                 # Health metric calculation
│   ├── sqlite.d.ts              # SQLite type definitions
│   └── watcher.ts               # File system monitoring
│
├── src/                          # Frontend React application
│   ├── components/              # UI components
│   │   ├── BenchmarkPanel.tsx  # Rule testing dashboard
│   │   ├── CodebaseTreemap.tsx # Visual file health map
│   │   ├── FindingsPanel.tsx   # Issue list & filters
│   │   ├── OverviewPanel.tsx   # Health dashboard
│   │   ├── RuleDrawer.tsx      # Finding detail drawer
│   │   ├── SeverityLabel.tsx   # UI primitives
│   │   └── SourceInspector.tsx # Code viewer
│   │
│   ├── App.tsx                  # Root component
│   ├── main.tsx                 # Application entry point
│   ├── types.ts                 # Shared TypeScript interfaces
│   └── index.css                # Global styles
│
├── dist/                         # Production build output (generated)
├── node_modules/                 # Dependencies (generated)
│
├── .env.example                  # Environment variable template
├── .gitignore                    # Git ignore rules
├── bun.lock                      # Bun lockfile
├── codepulse.db                  # SQLite database (generated)
├── codepulse.db-shm             # SQLite shared memory (generated)
├── codepulse.db-wal             # SQLite write-ahead log (generated)
├── index.html                    # HTML entry point
├── metadata.json                 # Project metadata
├── package.json                  # Dependencies & scripts
├── package-lock.json             # npm lockfile
├── README.md                     # Project overview
├── server.ts                     # Express server entry point
├── tsconfig.json                 # TypeScript configuration
└── vite.config.ts                # Vite bundler configuration
```

## Folder Responsibilities

### `/docs` - Documentation

**Purpose**: All project documentation in one place

**Contents**:
- Architecture overviews
- Decision records (ADR)
- Module guides
- API documentation
- Setup instructions

**Guidelines**:
- Use Markdown format
- Keep files focused (one topic per file)
- Update when architecture changes
- Include diagrams where helpful

---

### `/server` - Backend Services

**Purpose**: All server-side logic and business rules

**Subfolders**:

#### `/server/analyzers` - Analysis Engines

**Purpose**: Individual code analysis implementations

**Structure**:
- One file per analyzer type
- `base.ts` contains shared utilities
- Each analyzer implements the `Analyzer` interface

**Naming Convention**: `{language}{Type}Analyzer.ts`
- Examples: `jsAnalyzer.ts`, `pyComplexity.ts`, `secrets.ts`

**Guidelines**:
- Keep analyzers independent (no cross-dependencies)
- Focus on specific concern (security, complexity, style)
- Return findings with high confidence
- Document false positive cases

#### `/server/data` - Static Reference Data

**Purpose**: Lookup tables and reference datasets

**Current Contents**:
- CVE vulnerability database
- (Future: OWASP patterns, CWE mappings)

**Guidelines**:
- Use TypeScript for type safety
- Export as constants
- Document data sources
- Include last-updated dates

#### `/server/eval` - Quality Assurance

**Purpose**: Analyzer validation and testing

**Structure**:
- `benchmarkSuite.ts`: Test cases and expected results
- `runEval.ts`: Test runner and reporter

**Guidelines**:
- Add test case for each new rule
- Include edge cases
- Measure precision and recall
- Run before releases

#### `/server/samples` - Demo Workspaces

**Purpose**: Sample projects for testing and demos

**Guidelines**:
- Include intentional issues
- Cover multiple languages
- Represent real-world scenarios
- Keep files small (<100 lines)

---

### `/src` - Frontend Application

**Purpose**: React SPA user interface

**Subfolders**:

#### `/src/components` - UI Components

**Purpose**: Reusable React components

**Organization**:
- One component per file
- Co-locate component-specific types
- Group related components in subdirectories (future)

**Naming Convention**: PascalCase matching component name
- Example: `OverviewPanel.tsx` exports `OverviewPanel`

**Guidelines**:
- Keep components under 500 lines
- Extract complex logic to custom hooks
- Use TypeScript interfaces for props
- Document props with JSDoc comments

**Component Categories**:

| Category | Examples | Purpose |
|----------|----------|---------|
| **Panels** | OverviewPanel, FindingsPanel | Top-level views |
| **Visualizations** | CodebaseTreemap, TrendChart | Data displays |
| **Editors** | SourceInspector, RuleDrawer | Interactive content |
| **UI Primitives** | SeverityLabel, Badge | Reusable elements |

---

### `/dist` - Production Build

**Purpose**: Compiled frontend assets

**Generated by**: `npm run build`

**Contents**:
- Minified JavaScript bundles
- Optimized CSS
- HTML entry point
- Static assets (images, fonts)

**Note**: Excluded from Git (generated artifact)

---

### `/.claude` - Claude Code Configuration

**Purpose**: Claude Code IDE integration

**Contents**:
- Session state
- Write tracking
- Project-specific settings

**Note**: Managed by Claude Code, not manually edited

---

## File Naming Conventions

### TypeScript/JavaScript

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `OverviewPanel.tsx` |
| Utilities | camelCase | `gitdiff.ts` |
| Classes | PascalCase | `Engine.ts` |
| Types/Interfaces | PascalCase | `models.ts` |
| Configuration | camelCase | `config.ts` |

### Documentation

| Type | Convention | Example |
|------|------------|---------|
| Architecture | UPPERCASE | `ARCHITECTURE.md` |
| Guides | UPPERCASE | `MODULE_GUIDE.md` |
| General | sentence-case | `README.md` |

### Database

| Type | Convention | Example |
|------|------------|---------|
| Database files | lowercase + extension | `codepulse.db` |
| SQLite internals | db-name + suffix | `codepulse.db-wal` |

---

## Recommended Improvements

### Current Pain Points

1. **Flat server folder**: All core modules in one directory
2. **No test folder**: Tests mixed with source
3. **No types folder**: Types scattered across files
4. **No hooks folder**: Custom React hooks inline
5. **No utils folder**: Utilities mixed with business logic

### Proposed Structure (Future)

```
codepulse/
├── server/
│   ├── analyzers/           # Keep as-is
│   ├── core/                # NEW: Core business logic
│   │   ├── engine.ts
│   │   ├── watcher.ts
│   │   └── score.ts
│   ├── data/                # Keep as-is
│   ├── db/                  # NEW: Database layer
│   │   ├── database.ts
│   │   ├── migrations/
│   │   └── queries/
│   ├── eval/                # Keep as-is
│   ├── integrations/        # NEW: External integrations
│   │   ├── git.ts
│   │   └── ollama.ts
│   ├── samples/             # Keep as-is
│   ├── types/               # NEW: Shared type definitions
│   │   ├── models.ts
│   │   └── api.ts
│   ├── utils/               # NEW: Utilities
│   │   ├── hash.ts
│   │   └── fingerprint.ts
│   └── config.ts            # Keep
│
├── src/
│   ├── components/          # Keep as-is
│   ├── hooks/               # NEW: Custom React hooks
│   │   ├── useWebSocket.ts
│   │   └── useWorkspace.ts
│   ├── services/            # NEW: API clients
│   │   └── api.ts
│   ├── types/               # NEW: Frontend types
│   │   └── index.ts
│   ├── utils/               # NEW: Frontend utilities
│   │   └── format.ts
│   ├── App.tsx              # Keep
│   └── main.tsx             # Keep
│
├── tests/                   # NEW: Test suite
│   ├── unit/
│   │   ├── analyzers/
│   │   └── core/
│   ├── integration/
│   └── e2e/
```

### Migration Path

**Phase 1: Non-Breaking Additions**
1. Create `/server/types` and move `models.ts`
2. Create `/src/hooks` and extract custom hooks
3. Create `/tests` and add first test

**Phase 2: Refactoring**
1. Create `/server/core` and move engine, watcher, score
2. Create `/server/db` and move database logic
3. Create `/server/integrations` and move git, explain

**Phase 3: Organization**
1. Create `/server/utils` for shared utilities
2. Create `/src/services` for API clients
3. Update all imports

---

## File Organization Principles

### 1. Separation of Concerns

Each folder has a single, well-defined responsibility:
- `/server/analyzers` - detection logic only
- `/server/core` - orchestration and workflow
- `/src/components` - UI presentation only

### 2. Colocation

Related files stay close:
- Analyzer test cases near analyzers
- Component types near components
- Demo projects near demo logic

### 3. Discoverability

Clear naming makes files easy to find:
- `/server/analyzers/jsAnalyzer.ts` - obvious what it does
- `/docs/ARCHITECTURE.md` - obvious what it contains
- `/server/eval/runEval.ts` - obvious it's executable

### 4. Scalability

Structure supports growth:
- Add new analyzer → drop file in `/analyzers`
- Add new component → drop file in `/components`
- Add new documentation → drop file in `/docs`

### 5. Minimal Nesting

Avoid deep folder hierarchies:
- Max 3 levels deep
- Group only when >5 files in category
- Prefer flat over nested

---

## Import Conventions

### Absolute vs Relative

**Backend (server/)**:
```typescript
// Prefer relative for nearby files
import { Engine } from './engine'
import { Database } from './db'

// Use absolute for analyzers (from any file)
import { JsAnalyzer } from './analyzers/jsAnalyzer'
```

**Frontend (src/)**:
```typescript
// Prefer relative for components
import { OverviewPanel } from './components/OverviewPanel'

// Use absolute for types (future)
import type { Finding } from '@/types'
```

### Import Order

1. Node.js built-ins (`fs`, `path`)
2. External packages (`express`, `react`)
3. Internal modules (relative imports)
4. Types (last)

Example:
```typescript
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { WebSocket } from 'ws'

import { Engine } from './engine'
import { Database } from './db'

import type { Finding, FileReport } from './models'
```

---

## Generated Files

These files are auto-generated and should not be edited manually:

| File | Generator | Frequency |
|------|-----------|-----------|
| `dist/` | Vite | On build |
| `node_modules/` | npm/bun | On install |
| `codepulse.db` | SQLite | Runtime |
| `codepulse.db-wal` | SQLite | Runtime |
| `codepulse.db-shm` | SQLite | Runtime |
| `.claude/.cc-writes/` | Claude Code | Runtime |

**Git Ignore**:
```gitignore
# Build outputs
dist/
*.js

# Dependencies
node_modules/

# Database
*.db
*.db-wal
*.db-shm

# Environment
.env
.env.local

# IDE
.vscode/
.idea/
.claude/

# OS
.DS_Store
Thumbs.db
```

---

## Adding New Files

### Checklist

When adding a new file, ask:

- [ ] Is the folder correct?
- [ ] Is the name descriptive?
- [ ] Does it follow naming conventions?
- [ ] Is there a better existing location?
- [ ] Does it need documentation?
- [ ] Should it be in `.gitignore`?

### Examples

**Adding a New Analyzer**:
1. Create: `server/analyzers/goAnalyzer.ts`
2. Implement: `Analyzer` interface
3. Register: In `engine.ts`
4. Test: Add cases to `benchmarkSuite.ts`
5. Document: Update `MODULE_GUIDE.md`

**Adding a New Component**:
1. Create: `src/components/MetricsPanel.tsx`
2. Define: Props interface
3. Import: In `App.tsx`
4. Route: Add to view switching logic
5. Style: Use Tailwind classes

**Adding Documentation**:
1. Create: `docs/NEW_TOPIC.md`
2. Format: Use Markdown
3. Link: Reference in `README.md`
4. Review: Ensure accuracy
5. Commit: With descriptive message

---

## Best Practices

### File Size Limits

| File Type | Recommended Max | Hard Limit |
|-----------|----------------|------------|
| Components | 300 lines | 500 lines |
| Utilities | 200 lines | 300 lines |
| Analyzers | 400 lines | 600 lines |
| Documentation | 1000 lines | 2000 lines |

**When to split**:
- Extract helper functions to utilities
- Create sub-components
- Use separate files for types
- Consider separate concerns

### Folder Size Limits

| Folder | Recommended Max | When to Split |
|--------|----------------|---------------|
| `/components` | 15 files | Create subdirectories |
| `/analyzers` | 20 files | Group by language |
| `/utils` | 10 files | Group by category |

### Documentation Requirements

Every folder should have:
- README (for public APIs)
- Comments (for complex logic)
- Type definitions (for interfaces)

Not needed:
- Self-evident code
- Temporary folders
- Generated artifacts

---

## Troubleshooting

### "Module not found" Errors

**Symptoms**: Import fails with error

**Causes**:
1. Wrong relative path
2. Missing file extension
3. Case mismatch (macOS hides this)

**Solutions**:
```bash
# Check file exists
ls -la server/engine.ts

# Verify import path
# ✓ import { Engine } from './engine'
# ✗ import { Engine } from './Engine'  (case matters)
```

### "Circular Dependency" Warnings

**Symptoms**: Module imports itself indirectly

**Solution**: Extract shared code to separate file
```typescript
// Before: a.ts ← b.ts ← a.ts
// After:  a.ts ← shared.ts → b.ts
```

### Build Output Missing Files

**Symptoms**: File not in `dist/` after build

**Causes**:
1. Not imported anywhere (tree-shaken)
2. Import path wrong
3. Vite configuration issue

**Solutions**:
```bash
# Verify import chain
npm run build -- --debug

# Check Vite config
cat vite.config.ts
```

---

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [MODULE_GUIDE.md](./MODULE_GUIDE.md) - Module documentation
- [DECISIONS.md](./DECISIONS.md) - Architectural decisions
- [package.json](../package.json) - Scripts and dependencies

---

**Last Updated**: 2026-10-25  
**Version**: 1.0.0
