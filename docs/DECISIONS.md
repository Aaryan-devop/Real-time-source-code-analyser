# CodePulse — Architectural Decisions Record

## 1. Local-Only Privacy & Zero External Telemetry
- **Decision**: Static analysis, secret scanning, duplicate block hashing, git diff inspection, and dependency vulnerability checks run 100% locally without outbound network calls.
- **Rationale**: Ensures proprietary source code never leaves the developer machine.

## 2. Debounced File Watching & SHA-256 Content Caching
- **Decision**: Recursive directory events are debounced per file path at 300ms, and SQLite (WAL mode) caches SHA-256 content digests per file.
- **Rationale**: Collapses burst editor auto-saves into a single incremental pass (<50ms typical per edited file) while skipping unchanged files.

## 3. LOC-Normalized Health Score Formula
- **Decision**: Score starts at `100.0` and subtracts severity-weighted penalties (`Critical: 10`, `High: 5`, `Medium: 2`, `Low: 0.5`, `Info: 0`) normalized against total lines of code:
  `penalty_density = (total_penalty / max(LOC, 50)) * 100`
  `score = clamp(round(100.0 - penalty_density, 1), 0.0, 100.0)`
  Dismissed findings contribute zero penalty.
- **Rationale**: Prevents large repositories from being zeroed out by isolated findings while maintaining strict quality thresholds on compact services.

## 4. Line-Drift-Resistant Fingerprinting
- **Decision**: Each finding fingerprint is computed as `sha256("${rel_path}:${rule_id}:${normalized_snippet}")[:16]`.
- **Rationale**: Dismissals and finding identities survive unrelated line insertions or deletions above the flagged code block.

## 5. Mandatory Secret Redaction Before Persistence
- **Decision**: Credential scanners redact matched tokens (`AKIA***`, `sk_***`, `[REDACTED]`) prior to creating `Finding` records, SQLite rows, WebSocket payloads, or Markdown/JSON exports.
- **Rationale**: Prevents CodePulse itself from becoming a secondary secret leakage store.
