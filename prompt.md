# REAL-TIME SOURCE CODE ANALYSER: FULL MVP BUILD PROMPT

You are a senior full-stack engineer. Build the complete, working MVP described below in the current working directory. Do not ask me questions. If something is ambiguous, make a sensible choice, write it in `docs/DECISIONS.md`, and continue. No TODOs, stubs, or placeholder code in the core path. When finished, everything must run with the commands in the README.

**Work in the phases listed in section 9. Finish and verify each phase (run the code and tests) before starting the next. If a command or package fails, fix it or use the documented fallback. Never skip verification.**

---

## 1. WHAT WE ARE BUILDING

**CodePulse**: a live code-health dashboard. The user points it at a project folder. Every time a file is saved, CodePulse re-analyses only that file (target: results in about 1 second) and updates a web dashboard in real time showing what is wrong, why it matters, and how to fix it.

### Principles
1. **Fast and incremental.** Only changed files are re-analysed. Unchanged files use cached results.
2. **Private by default.** Everything runs locally. No source code is ever sent to the internet. The optional AI explainer uses a local model (Ollama) only.
3. **Honest.** Static analysis has false positives. Every finding shows a severity and a confidence level, and users can dismiss findings. Never claim it finds all bugs or vulnerabilities. Report measured numbers only.
4. **Works with just `pip install` and `npm install`.** Optional pieces (Ollama explanations, tree-sitter for JavaScript) must degrade gracefully with a built-in fallback so the demo never breaks.

---

## 2. TECH STACK

| Layer | Choice |
|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn, asyncio, WebSocket |
| File watching | `watchdog` (with debounce of ~300 ms per file) |
| Python analysis | Python's built-in `ast` module |
| JavaScript/TypeScript analysis | `tree-sitter` + `tree-sitter-javascript` if they install cleanly; otherwise a regex/token-based fallback with fewer checks (state which one is active) |
| Storage | SQLite (stdlib `sqlite3`, WAL mode) |
| Models/validation | Pydantic v2 |
| Frontend | React + Vite, WebSocket client, `recharts` for charts |
| Optional AI explainer | Ollama (default model `qwen2.5-coder:1.5b`), local only, with a templated fallback |
| Tests | pytest, httpx |

---

## 3. REPOSITORY LAYOUT

```
codepulse/
├── README.md
├── Makefile
├── .env.example
├── docs/
│   ├── DECISIONS.md
│   ├── ARCHITECTURE.md
│   └── DEMO_SCRIPT.md
├── backend/
│   ├── requirements.txt
│   ├── requirements-optional.txt
│   ├── codepulse/
│   │   ├── __init__.py
│   │   ├── main.py             # FastAPI app, routes, WebSocket
│   │   ├── config.py           # env-driven settings
│   │   ├── models.py           # Finding, FileReport, ProjectReport, enums
│   │   ├── watcher.py          # watchdog + debounce + ignore rules
│   │   ├── engine.py           # orchestrates analysis of one file, caching
│   │   ├── db.py               # SQLite: files, findings, history, dismissals
│   │   ├── score.py            # health score calculation
│   │   ├── gitdiff.py          # "new since last commit" detection
│   │   ├── explain.py          # Ollama explainer + templated fallback
│   │   ├── analyzers/
│   │   │   ├── base.py         # Analyzer interface
│   │   │   ├── py_complexity.py
│   │   │   ├── py_smells.py
│   │   │   ├── py_security.py
│   │   │   ├── js_analyzer.py  # tree-sitter or fallback
│   │   │   ├── secrets.py      # language-agnostic secret detection
│   │   │   ├── duplicates.py   # project-wide duplicate block detection
│   │   │   └── dependencies.py # known-vulnerable dependency check (offline data file)
│   │   └── data/
│   │       └── vulnerable_packages.json   # small curated offline list
│   ├── tests/
│   ├── eval/
│   │   ├── fixtures/           # files with known, labelled issues
│   │   ├── run_eval.py         # precision/recall on fixtures
│   │   └── results/
│   └── samples/
│       └── demo_project/       # intentionally flawed sample project for the demo
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   └── src/
└── scripts/
    ├── dev.sh
    └── dev.bat
```

---

## 4. BACKEND SPECIFICATION

### 4.1 Data models (`models.py`)
- `Severity`: `critical`, `high`, `medium`, `low`, `info`.
- `Category`: `security`, `complexity`, `smell`, `duplicate`, `dependency`.
- `Confidence`: `high`, `medium`, `low`.
- `Finding`: `{ id, file, line, end_line, rule_id, category, severity, confidence, title, message, why_it_matters, suggested_fix, snippet, fingerprint, is_new, dismissed }`. The `fingerprint` is a stable hash of (file, rule_id, normalized snippet) so a finding keeps its identity when lines shift.
- `FileReport`: `{ path, language, loc, findings, complexity_avg, complexity_max, analyzed_at, duration_ms }`.
- `ProjectReport`: `{ score, grade, counts_by_severity, counts_by_category, files, trend }`.

### 4.2 Watcher (`watcher.py`)
- Watch the target folder recursively with `watchdog`.
- Debounce events per file (~300 ms) so editor save bursts trigger one analysis.
- Ignore: `.git`, `node_modules`, `__pycache__`, `venv`, `.venv`, `dist`, `build`, binary files, files over 1 MB (configurable).
- On create/modify: analyse that file. On delete: remove its findings. On rename: treat as delete + create.
- On startup: do one initial scan of all supported files (run in a thread pool so the server stays responsive) and stream progress over the WebSocket.

### 4.3 Engine (`engine.py`)
- `analyze_file(path)`: read the file, compute a content hash, **skip if the hash is unchanged** (cache hit), otherwise run all applicable analyzers, assign fingerprints, mark `is_new` using git diff data (4.8), apply stored dismissals, save to SQLite, and return a `FileReport`.
- Measure `duration_ms` with `time.perf_counter()` and show it in the UI. Never fake timing.
- Catch exceptions per analyzer: a crash in one analyzer must never stop the others. Surface analyzer errors as a clearly marked "analyzer error" info entry.
- A file with a syntax error must produce a single `info`/`medium` finding "Syntax error at line N" and not crash.

### 4.4 Analyzers (all must implement `Analyzer.analyze(path, source) -> list[Finding]`)

**Complexity (`py_complexity.py`, Python via `ast`)**
- Cyclomatic complexity per function (count `if`, `for`, `while`, `except`, `with`, boolean operators, comprehensions, `match` cases). Flag: >10 medium, >15 high, >25 critical.
- Function length (>50 lines medium, >100 high), nesting depth (>4 medium), too many parameters (>6 low).
- File-level `complexity_avg` and `complexity_max`.

**Smells (`py_smells.py`)**
- Unused imports, unused local variables, unreachable code after `return`/`raise`, bare `except:`, mutable default arguments, `print` left in non-script code (low), overly broad `except Exception` with `pass`, TODO/FIXME/HACK comments (info), very long lines (low), missing docstrings on public functions (info, off by default).

**Security (`py_security.py`)**
Detect with AST (not just regex) and give a clear `why_it_matters` and `suggested_fix` for each:
- `eval`, `exec`, `compile` on non-literals
- `pickle.load(s)`, `yaml.load` without `SafeLoader`, `marshal.loads`
- `subprocess` with `shell=True`, `os.system`, `os.popen`
- SQL built with string formatting, f-strings, `%` or `+` passed to `.execute()`
- `hashlib.md5` / `sha1` used for passwords or security
- `random` used for tokens or secrets (suggest `secrets`)
- `requests` with `verify=False`, `ssl._create_unverified_context`
- Flask/Django `debug=True`, binding to `0.0.0.0` (low)
- `tempfile.mktemp`, `assert` used for security checks (low), insecure deserialization, path traversal patterns (`open(user_input)` heuristics, marked low confidence)
- Each security rule has a stable `rule_id` such as `CP-SEC-001` and, where applicable, a CWE reference (for example CWE-78 for command injection, CWE-89 for SQL injection, CWE-798 for hard-coded credentials).

**Secrets (`secrets.py`, any text file)**
- Regex + entropy detection for: AWS access keys (`AKIA...`), private key blocks, generic `password|secret|token|api_key = "..."` assignments, bearer tokens, connection strings with credentials, high-entropy strings in assignments to suspicious names.
- Ignore obvious placeholders (`changeme`, `your_api_key`, `xxxx`, `example`) and test fixtures marked low confidence.
- **Never store the full secret.** The finding snippet must be redacted (first 3 chars + `***`).

**JavaScript/TypeScript (`js_analyzer.py`)**
- With tree-sitter: function complexity and length, `eval`, `new Function`, `innerHTML =` / `dangerouslySetInnerHTML` with non-literals, `document.write`, `child_process.exec` with concatenated strings, `==` instead of `===` (low), `console.log` left in (low), unused variables (basic), empty catch blocks.
- If tree-sitter is not available, use the regex fallback for the security rules only, and set a visible flag `js_engine: "fallback"` in `/api/health`.

**Duplicates (`duplicates.py`, project-wide)**
- Detect duplicated code blocks (minimum ~6 lines / ~50 tokens) across files using normalized token windows and rolling hashes. Report both locations. Recompute incrementally when a file changes. Duplicate findings are `smell` severity `low` to `medium`.

**Dependencies (`dependencies.py`)**
- Parse `requirements.txt`, `pyproject.toml` dependencies and `package.json`. Compare names and versions against the bundled offline `vulnerable_packages.json` (include about 15 well-known examples with a fixed version range, an advisory ID and a short note). **State clearly in the UI and README that this is a small curated offline list, not a complete vulnerability database.** Do not make network calls.

### 4.5 Explainer (`explain.py`)
- Every rule has a built-in templated `why_it_matters` and `suggested_fix` (always available, no AI needed).
- Optional: `POST /api/explain {finding_id}` calls local Ollama with the finding and a small code snippet and returns a short plain-language explanation and a suggested fixed snippet. Timeout 15 s. If Ollama is not running, return the templated explanation and set `ai: false`. The UI shows whether the AI explainer is active. The source code never leaves the machine.

### 4.6 Health score (`score.py`)
- Score 0–100: start at 100 and subtract weighted penalties per finding (critical 10, high 5, medium 2, low 0.5; info 0), scaled so large projects aren't unfairly zeroed (for example, normalize by lines of code). Dismissed findings don't count. Map to a grade A–F.
- Document the formula in `docs/DECISIONS.md` and show it in the UI ("how is this calculated?").
- Store a history point (timestamp, score, counts) after each analysis, capped at a sensible number, to power the trend chart.

### 4.7 Storage (`db.py`)
SQLite WAL. Tables: `files(path, hash, language, loc, analyzed_at)`, `findings(...)`, `dismissals(fingerprint, reason, created_at)`, `history(ts, score, counts_json)`. Dismissals persist across restarts and matched by `fingerprint`.

### 4.8 Git-aware "new issues" (`gitdiff.py`)
- If the target folder is a git repo (use `subprocess` calling `git`, with a safe, non-shell invocation and a timeout), mark findings on lines changed since `HEAD` as `is_new = true`. If it is not a git repo or git is missing, `is_new` is always false and the UI hides the "new only" filter. Never crash on git errors.

### 4.9 API surface (`main.py`)
- `POST /api/project {path}`: set/change the watched folder and start the initial scan.
- `GET /api/report`: current `ProjectReport`.
- `GET /api/files`, `GET /api/files/{path:path}`: file reports and findings.
- `GET /api/findings?severity=&category=&file=&new_only=&include_dismissed=`
- `POST /api/findings/{id}/dismiss {reason}` and `POST /api/findings/{id}/restore`
- `POST /api/explain {finding_id}`
- `POST /api/analyze {path}`: force re-analysis of one file.
- `GET /api/history`
- `GET /api/health`: engine status (js_engine, ollama active, git available, watcher running, files indexed).
- `POST /api/sample`: point the watcher at the bundled demo project (copied to a temp folder so it can be edited safely).
- `GET /api/export?format=json|md`: export a report. Markdown export includes a summary table and the list of findings.
- `WS /ws`: events `scan_progress`, `file_analyzed`, `finding_added`, `finding_removed`, `score_update`, `watcher_status`.
- **Security of the tool itself:** bind to `127.0.0.1` by default; validate that `path` exists and is a directory; never read outside the chosen root; never execute analysed code; limit file size; return errors as JSON, never stack traces; enable CORS only for the Vite dev origin. Serve the built frontend from FastAPI so one command runs everything.

---

## 5. FRONTEND SPECIFICATION (React + Vite)

A clean, dark, projector-friendly dashboard, large readable text, good contrast, keyboard accessible. Severity colors: critical = red, high = orange, medium = yellow, low = blue, info = grey.

1. **Header:** "CodePulse" + a "Local only: your code never leaves this machine" badge + a live connection indicator.
2. **Project bar:** input for the folder path, a "Watch" button, and a **"Load demo project"** button. Shows files indexed and last analysis time.
3. **Health score card:** big score, grade letter, and an arrow showing change since the last save (for example, `+3`). A "how is this calculated?" popover.
4. **Counts:** severity chips and category chips that double as filters.
5. **Trend chart (recharts):** score over time, updating live as files are saved.
6. **File heatmap:** a grid or treemap of files colored by worst severity, size by lines of code; clicking a file filters the findings.
7. **Findings list:** filterable and sortable list. Each row shows severity badge, confidence, rule id (with CWE where available), title, file:line, and a **"NEW"** tag where applicable. Expanding a row shows a code snippet with the offending line highlighted, "why this matters", "suggested fix", an **"Explain with local AI"** button, and **Dismiss** (with a reason) / Restore.
8. **Live activity feed:** "utils.py re-analysed in 84 ms, 2 findings fixed, 1 new", with a brief highlight animation when the score changes.
9. **Engine status strip:** honest indicators: Python analyzer, JS engine (tree-sitter / fallback), Ollama (on / off), git (on / off), duplicate detector.
10. **Export button:** download the JSON or Markdown report.
11. **Empty and error states:** friendly messages for invalid paths, an empty project, a lost WebSocket (auto-reconnect with backoff).

---

## 6. DEMO PROJECT (`backend/samples/demo_project/`)

Create a small, realistic but **intentionally flawed** sample app (Python Flask-style API plus a small JavaScript file) containing at least one example of each of these: hard-coded password, SQL string formatting, `eval` on user input, `subprocess` with `shell=True`, `pickle.load`, bare `except`, an unused import, a function with cyclomatic complexity above 15, a duplicated block across two files, a vulnerable pinned dependency in `requirements.txt`, and `innerHTML` with user data in the JS file.

`docs/DEMO_SCRIPT.md` must contain a 2-minute live demo: load the demo project, show the score and findings, open the hard-coded password finding, fix it in the editor and save, watch the finding disappear and the score rise within about a second, then introduce a new `eval` and watch a "NEW" critical finding appear. Include exact timing and what to say.

---

## 7. EVALUATION (honest measurement)

- `eval/fixtures/` holds files with **labelled** expected findings (a JSON sidecar listing expected `rule_id` and line per file), including **clean files with known false-positive traps** (for example, a variable named `password_field` with no secret, a safe parameterized SQL query, `subprocess` with `shell=False`).
- `eval/run_eval.py` runs the engine on the fixtures and reports **precision, recall and F1 per category and per rule**, plus the list of misses and false positives, plus the median and p95 analysis time per file (ms). Write `results/eval_report.md` and `results/eval_results.json`.
- Add a "Limitations and measured results" section to the README that quotes the real numbers from the latest run. **Never hard-code, estimate, or fake a result.** `make eval` runs it.

---

## 8. TESTS

pytest tests covering at minimum:
- Each analyzer: at least one positive and one negative case per rule.
- Syntax-error files don't crash the engine.
- Cache: an unchanged file is not re-analysed; a changed file is.
- Fingerprints stay stable when lines shift.
- Dismissals persist and are applied after restart.
- Secret findings are redacted, and placeholders are ignored.
- Health score math and grade mapping.
- Watcher debounce: a burst of writes triggers one analysis (use a temp directory).
- Git-aware `is_new` (create a temp git repo in the test); graceful behavior with no git.
- API tests with httpx for the main endpoints, path validation (reject non-existent and non-directory paths), and a WebSocket event test.
- Fix any failing test before moving on.

---

## 9. BUILD PHASES (verify each before continuing)

1. **Scaffold:** repo layout, dependencies installed, FastAPI "hello" and the Vite app both start.
2. **Core:** models, db, config, engine skeleton, cache, scoring. Tests pass.
3. **Python analyzers:** complexity, smells, security, secrets. Tests pass.
4. **Other analyzers:** JS (with fallback), duplicates, dependencies. Tests pass.
5. **Live layer:** watcher, git diff, API, WebSocket. Tests pass.
6. **Explainer:** templated + optional Ollama with fallback.
7. **Frontend:** all dashboard panels, then `npm run build` completes with no errors.
8. **Demo project + eval harness:** run `make eval`.
9. **Docs:** README, ARCHITECTURE, DECISIONS, DEMO_SCRIPT.
10. **Final verification:** run the full test suite, run `make eval`, start the server, load the demo project via the API, modify a demo file and confirm via the API or WebSocket that the findings and score update within a few seconds. Fix anything that fails and re-run.

---

## 10. DOCS AND DEV EXPERIENCE

- **README.md:** what it is, why it's different (live, incremental, private, git-aware, explains fixes), screenshots section placeholder, a quickstart of at most 3 commands, an env var table, how to enable optional Ollama and tree-sitter, how to run tests and eval, the demo steps, an honest **Limitations** section (static analysis false positives, small curated offline vulnerability list, limited language support, heuristics are not a replacement for a full SAST tool), and a roadmap (more languages, IDE plugin, pre-commit hook mode, SARIF export, CI mode, custom rules).
- **Makefile:** `setup`, `dev`, `build`, `run` (everything on one port), `test`, `eval`, `clean`. Also `scripts/dev.sh` and `scripts/dev.bat`.
- **.env.example** documents every variable (host, port, ignore patterns, max file size, debounce ms, Ollama URL and model, score weights).
- `requirements.txt` must install cleanly without optional packages. Pin sensible versions.

---

## 11. QUALITY BAR

- Type hints and docstrings on public functions; clear logging; no secrets in code; no telemetry; no network calls in the analysis path.
- Modular, readable code with comments where the design is non-obvious (fingerprinting, debounce, score formula, incremental duplicate detection).
- The demo must be reliable: loading the sample project, editing a file, and the live update must work every time.
- If a package cannot be installed, keep going with the documented fallback. Do not block.

---

## 12. FINAL OUTPUT

When finished, print a concise summary with:
1. Exact commands to install and run the project, and the URL to open.
2. Test results (pass counts).
3. The real eval numbers (precision, recall, timing) from `make eval`.
4. Which optional engines are active (tree-sitter, Ollama, git) and which are using fallbacks.
5. Assumptions you made and anything I need to do manually (for example `ollama pull qwen2.5-coder:1.5b`).

Begin now. Build the whole project.
