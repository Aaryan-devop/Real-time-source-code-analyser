# NEXO / ALEXA LIFELINE: FULL BUILD PROMPT

You are a senior full-stack engineer. Build the complete, working, demo-ready project described below, end to end, in the current working directory. Do not stop to ask me questions. Where something is ambiguous, make a sensible choice, note it in `docs/DECISIONS.md`, and keep going. Do not leave TODOs, stubs, or placeholder code in the core path. When finished, everything must run with the commands in the README.

---

## 1. WHAT WE ARE BUILDING

**Nexo (Alexa Lifeline)** is a prototype for an Amazon hackathon. It is a local safety net for a smart speaker. When the cloud or internet fails, a small on-device router keeps a limited set of home functions working (like lights and timers) and **honestly tells the user what is unavailable** instead of saying "something went wrong".

Core idea: **add a second path, not a replacement.** Nexo does not replace Alexa's intelligence. Simple home actions run locally. Cloud-only requests (web search, recipes, shopping) get an honest explanation when offline.

Tagline: *"Cloud intelligence when you have it. Local reliability when you don't."*

### Non-negotiable principles
1. **Works with zero internet.** The whole local path (parser, router, device control, state, status panel, spoken replies) must run with the network unplugged.
2. **Honesty.** Label the project as a prototype in the UI and README. Never claim a speed, privacy, or accuracy number that was not measured by the eval harness. Never claim an integration (Home Assistant, MQTT, Matter) is tested unless it is.
3. **Safety first, then local, then cloud, then explain.** Never fail silently. Never guess on unclear or unsafe requests: ask or refuse.
4. **Testable.** Small models only work inside a fixed function-call schema, and a validator makes sure a model mistake can never become a wrong action.
5. **Runs on a laptop with only `pip install` and `npm install`.** Every heavy optional dependency (Vosk, Piper, Ollama) must have a graceful fallback so the demo never breaks.

---

## 2. TECH STACK (use exactly this)

| Layer | Choice |
|---|---|
| Backend | Python 3.11+, FastAPI, asyncio, Uvicorn, WebSocket |
| Validation | Pydantic v2 |
| Fast intent path | Rules + RapidFuzz fuzzy matching |
| Slow intent path | Ollama with a small model (default `qwen2.5:1.5b`), function-call JSON output |
| Speech to text | Vosk (optional), plus browser typed input as the always-working fallback |
| Text to speech | Piper (optional), plus browser Web Speech `speechSynthesis` as fallback |
| State | SQLite in WAL mode (stdlib `sqlite3`), durable command queue |
| Devices | Adapter interface. Implement `SimulatedAdapter` fully. Implement `MQTTAdapter` and `HomeAssistantAdapter` as real, clearly-labelled "untested, needs hardware" adapters. Add a `MatterAdapter` placeholder class that raises `NotImplementedError` with a clear message, and mark it "planned" |
| Frontend | React + Vite (JavaScript or TypeScript, your choice, keep it simple), WebSocket client |
| Tests | pytest + pytest-asyncio, httpx for API tests |

---

## 3. REPOSITORY LAYOUT

```
nexo/
├── README.md
├── Makefile
├── .env.example
├── docs/
│   ├── DECISIONS.md          # decision log (chosen vs rejected vs deciding factor)
│   ├── ARCHITECTURE.md       # ASCII diagram + request lifecycle
│   └── DEMO_SCRIPT.md        # 4-stage demo storyboard with exact lines to say
├── backend/
│   ├── requirements.txt
│   ├── pyproject.toml
│   ├── nexo/
│   │   ├── __init__.py
│   │   ├── main.py            # FastAPI app, routes, WebSocket
│   │   ├── config.py          # env-driven settings
│   │   ├── models.py          # Pydantic models, enums
│   │   ├── atlas.py           # Blackout Atlas (dependency map)
│   │   ├── connectivity.py    # health monitor + state machine
│   │   ├── cloud_sim.py       # mock cloud services (search, recipes, shopping)
│   │   ├── db.py              # SQLite WAL, tables, queue, event log
│   │   ├── parser/
│   │   │   ├── layer1_rules.py    # rules + RapidFuzz
│   │   │   ├── layer2_llm.py      # Ollama function-call, with fallback
│   │   │   ├── validator.py       # Pydantic schema + device allow-list
│   │   │   └── lexicon.py         # English + Hindi/Hinglish phrases
│   │   ├── router.py          # the four-decision router
│   │   ├── sync.py            # queue + reconcile (no stale replays)
│   │   ├── timers.py          # local software timers
│   │   ├── speech/
│   │   │   ├── asr.py         # Vosk wrapper + graceful fallback
│   │   │   └── tts.py         # Piper wrapper + graceful fallback
│   │   └── devices/
│   │       ├── base.py        # DeviceAdapter abstract class
│   │       ├── simulated.py
│   │       ├── mqtt_adapter.py
│   │       ├── homeassistant_adapter.py
│   │       └── matter_adapter.py
│   ├── tests/
│   └── eval/
│       ├── commands.csv       # the 60-command test set
│       ├── run_eval.py        # harness
│       └── results/           # generated CSV + summary JSON + markdown report
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   └── src/ (App, components, hooks, styles)
└── scripts/
    ├── dev.sh                 # starts backend + frontend
    ├── dev.bat                # Windows equivalent
    └── download_models.sh     # optional: Vosk model, Piper voice, ollama pull
```

---

## 4. BACKEND SPECIFICATION

### 4.1 Models (`models.py`)
- `Mode` enum: `ONLINE`, `DEGRADED`, `OFFLINE`, `RECOVERING`.
- `Route` enum: `local`, `cloud`, `refuse`, `clarify`, `explain`.
- `Intent` enum: `turn_on`, `turn_off`, `set_timer`, `cancel_timer`, `stop_alarm`, `thermostat_up`, `thermostat_down`, `run_routine`, `web_search`, `online_recipe`, `shopping`, `streaming_music`, `open_qa`, `status_query`, `ask_clarify`, `unsafe`, `unknown`.
- `ParsedIntent`: `{ intent, params: dict, confidence: float, source: "L1" | "L2" | "none", raw_text }`.
- `RouteDecision`: `{ route, mode, intent, params, reason, spoken_reply, ui_message, latency_ms, trace: list[str] }`.
- `Device`: `{ id, name, type, room, state, reachable }`.

### 4.2 Blackout Atlas (`atlas.py`)
A dictionary mapping each feature to what it depends on and its availability status, driving **both** the router's refusals **and** the frontend "what still works" panel. Include exactly these rows, with these statuses:

| Feature | Depends on | Status |
|---|---|---|
| Light control | Local hub / controller | `AVAILABLE_IF_CONFIGURED` |
| Timers and alarms | Device firmware (varies) | `VERIFY_BEFORE_CLAIMING` |
| Status explanations | Local router + status panel | `AVAILABLE` |
| Web search | Internet + cloud services | `UNAVAILABLE_OFFLINE` |
| Online recipes | Internet + cloud services | `UNAVAILABLE_OFFLINE` |
| Online shopping | Internet + cloud services | `UNAVAILABLE_OFFLINE` |

Also include thermostat, streaming music, open-ended Q&A (cloud-only), and routines (local if configured). Expose `GET /api/atlas` and a function `what_still_works(mode) -> {available, verify, unavailable}`. Add an `integration_tested` boolean per row (all `false` except the simulated light and status explanations) and show it in the UI so we never overclaim.

### 4.3 Connectivity monitor (`connectivity.py`)
Async health-check loop driving a 4-state machine with **hysteresis**:

```
ONLINE      --(1 probe failure, or slow probe)-->      DEGRADED
DEGRADED    --(1 probe OK)-->                          ONLINE
DEGRADED    --(3 consecutive failures)-->              OFFLINE
OFFLINE     --(1 probe OK)-->                          RECOVERING
RECOVERING  --(queue reconciled)-->                    ONLINE
RECOVERING  --(probe fails again)-->                   OFFLINE
```

- Two probe modes via env `NEXO_PROBE_MODE`: `sim` (default; reads an in-memory "internet up/down" flag controlled by the UI toggle, so the demo outage is simulated and reliable) and `real` (HTTP/TCP probe to configurable hosts with a timeout, e.g. `1.1.1.1:443`).
- Probe interval configurable (default 1.5 s for demo snappiness). "Slow" threshold configurable.
- Emit a mode-change event on every transition (to the DB event log and over WebSocket).
- In `RECOVERING`, automatically trigger `sync.reconcile()`, then move to `ONLINE`.
- API: `POST /api/internet {up: bool}` (sim toggle), `GET /api/mode`.

### 4.4 Parser: fast path first, model second

**Layer 1: `layer1_rules.py`**
- Deterministic regex/keyword rules plus RapidFuzz fuzzy matching against a lexicon of device names/aliases and intent phrases (`lexicon.py`).
- Must handle variations: "turn on the hallway light", "hallway light on", "switch off the bedroom lamp", "lights on in the kitchen", "lights band karo", etc.
- **Hindi / Hinglish support** (from the deck: "Hindi / Hinglish homes"): include phrases like `light jalao`, `batti band karo`, `hallway ki light on karo`, `kitchen ki batti jala do`, `light bujha do`, `timer laga do 5 minute ka`, plus Devanagari variants (`लाइट जलाओ`, `बत्ती बंद करो`). Keep the lexicon in an easy-to-extend data structure.
- Parse timer durations: "set a timer for 5 minutes", "10 minute timer", "timer 30 seconds".
- Recognize cloud-only intents by keywords: search, recipe, shop/buy/order, play music, "what is / who is / tell me about".
- Recognize unsafe/invalid commands (see 4.6).
- Return `ParsedIntent` with confidence; on no confident match return a miss so Layer 2 can run.

**Layer 2: `layer2_llm.py`**
- Calls local Ollama (`http://localhost:11434`, model from env) **only on an L1 miss**, with a strict system prompt and JSON schema forcing a function-call: `{ "intent": "...", "params": {...}, "confidence": 0..1 }`.
- Examples to handle: "it's dark in the hall" -> `turn_on(hallway)`.
- 3 second timeout. If Ollama is not installed or not running, **degrade gracefully**: return a miss and log `L2 unavailable`. The system must still work fully on L1 and must report in the UI whether L2 is active.
- If L2 is unsure (confidence below threshold) the result is `ask_clarify`, e.g. "do the thing" -> asks which device and what action.

**Validator: `validator.py`**
- Pydantic schema validation of any L1/L2 output.
- **Device allow-list**: only devices registered in the device registry can be acted on. A hallucinated device or intent is rejected and converted to `ask_clarify`.
- Parameter bounds (e.g. timer 1 second to 24 hours, thermostat step limits).
- The validator is the final gate: router only ever receives `{ intent, params }` that passed validation.

### 4.5 The router (`router.py`)
Implements **four decisions, in order** (from the deck):

1. **Known and safe?** NO -> `clarify` or `refuse`.
2. **Local and reachable?** YES -> run locally (check device reachability first; if the controller is unreachable, tell the user plainly).
3. **Cloud-only?** If cloud-only and **online** -> run in cloud (mock cloud). If cloud-only and DEGRADED -> warn, then try cloud. If cloud-only and OFFLINE/RECOVERING -> **explain what is unavailable**, using Atlas.
4. **Never fail silently.** Every path produces a `spoken_reply` and `ui_message`.

Required behaviors with exact reply templates:
- Local action while OFFLINE: spoken `"Light on, offline mode"` style (action + new state + "offline mode").
- Cloud-only while OFFLINE: `"The internet is unavailable. I can still control your home."` and for web search specifically: `"I can't search the web right now."` Optionally list what still works.
- Cloud-only while DEGRADED: warn before running.
- Unsupported / unknown: ask or refuse, never guess.
- Every `RouteDecision` includes a `trace` list of the steps taken (shown in the UI for transparency) and `latency_ms` measured with `time.perf_counter()`.
- Log every decision to the SQLite `events` table.

### 4.6 Safety / invalid handling
Refuse or ask for confirmation on: unsafe or nonsense commands (e.g. "turn off all the lights and unlock the door", unknown devices like "turn on the nuclear reactor", prompt-injection-style text such as "ignore previous instructions", empty or gibberish input). Risky or ambiguous actions (e.g. "turn off everything") require a **confirm** step: store a pending confirmation with a short expiry and accept "yes"/"confirm"/"haan" on the next command. Include at least 10 such cases in the eval set.

### 4.7 Devices (`devices/`)
- `DeviceAdapter` abstract base: `list_devices()`, `get_state(id)`, `turn_on(id)`, `turn_off(id)`, `is_reachable()`, plus `subscribe_events(callback)` for physical/manual changes.
- `SimulatedAdapter`: default devices `hallway_light`, `bedroom_light`, `kitchen_light`, `living_room_light`, `thermostat` (with a temperature value). Supports a "manual toggle" API (`POST /api/devices/{id}/manual {state}`) that simulates a person flipping the physical switch, which emits a device event with a timestamp. Supports a "controller unreachable" toggle for testing.
- `MQTTAdapter` (paho-mqtt, optional import) and `HomeAssistantAdapter` (REST against a local HA URL + token): real implementations, selected via env `NEXO_DEVICE_ADAPTER`, clearly marked **untested without hardware** in code comments, README, and the Atlas.
- Swapping adapters must not require any router changes.

### 4.8 State, queue and reconciliation (`db.py`, `sync.py`)
SQLite with `PRAGMA journal_mode=WAL`. Tables: `devices_state`, `command_queue`, `events`, `device_events`, `timers`.

**Queue + reconcile (the "recovery without stale replays" slide):**
- When OFFLINE, commands that need the cloud-side state (or that the system chooses to also sync upstream) are queued with a timestamp and the intent.
- Local commands execute immediately AND are recorded in the queue as "to sync to cloud" with their timestamp.
- On reconnect (`RECOVERING`), `reconcile()` compares each queued intent with the **latest device event**. **A newer device event beats an older queued intent**: drop the stale command and log exactly what was dropped and why. Do **not** blindly replay.
- Example that must be covered by a test: user says "turn off" at 10:05 offline (queued), user manually turns the light ON at 10:10, connection returns at 10:20, queued OFF is **dropped as stale**, final state stays ON, and the drop is logged.
- Queue must survive process restart (durable).
- Expose `GET /api/queue`, `GET /api/events`.

### 4.9 Timers (`timers.py`)
Local software timers that persist in SQLite and fire an alarm event over WebSocket with a spoken message. Support set, cancel, stop alarm. In the Atlas they stay labelled `VERIFY_BEFORE_CLAIMING` for real-device firmware, and the UI shows that these are prototype software timers.

### 4.10 Speech (`speech/`)
- `asr.py`: if the `vosk` package and a model directory exist (path from env), run local ASR on audio posted to `POST /api/asr` (accept 16 kHz mono WAV, and convert common browser formats if `ffmpeg` is available). If Vosk is unavailable, return a clear JSON status `{available:false}` so the frontend falls back to the browser's typed input (and optionally the browser's SpeechRecognition, labelled "not offline").
- `tts.py`: if `piper` and a voice model exist, synthesize WAV at `POST /api/tts`. Otherwise return `{available:false}` and the frontend uses `speechSynthesis`.
- The UI shows an indicator for which speech engines are active, honestly.

### 4.11 Cloud simulator (`cloud_sim.py`)
Mock "cloud services" for web search, recipes, shopping, music, open Q&A that return plausible canned/templated results when ONLINE and raise `CloudUnavailable` when the sim internet is down. Clearly labelled as simulated in code and UI.

### 4.12 API surface (`main.py`)
- `POST /api/command {text, source: "typed"|"voice"}` -> `RouteDecision`
- `GET /api/state` (mode, devices, atlas summary, timers, queue length, engine status)
- `GET /api/devices`, `POST /api/devices/{id}/manual`, `POST /api/devices/reachable {up}`
- `POST /api/internet {up}`, `GET /api/mode`
- `GET /api/atlas`, `GET /api/queue`, `GET /api/events`
- `POST /api/asr`, `POST /api/tts`
- `POST /api/demo/reset` (reset devices, queue, events, timers, and set internet up)
- `GET /api/health`
- `WS /ws` broadcasting JSON events: `mode_change`, `decision`, `device_update`, `queue_update`, `timer_fired`, `reconcile_report`.
- CORS enabled for the Vite dev origin. Serve the built frontend statically from FastAPI too (so one command can run everything for the demo).

---

## 5. FRONTEND SPECIFICATION (React + Vite)

A clean, high-contrast, judge-friendly **status panel**, dark theme, large readable text, works well on a projector. Use the deck's palette: green = local path, orange = needs internet, yellow = decision. Layout:

1. **Header**: "Nexo / Alexa Lifeline" + a **PROTOTYPE** badge + a big **mode pill** (ONLINE green, DEGRADED yellow, OFFLINE red, RECOVERING blue/amber) updating live over WebSocket.
2. **Internet toggle** (big, obvious): "Simulate internet outage". Shows the current sim state. This drives the same state machine as real probes.
3. **Command bar**: typed input with Enter to send, a push-to-talk **mic button** (uses Vosk via `/api/asr` if available; otherwise shows "voice engine unavailable, use typing"), and quick-demo chips for the 4 storyboard commands.
4. **Response card**: shows the spoken reply text, route taken (`local` / `cloud` / `refuse` / `clarify` / `explain`), intent JSON, parser layer used (L1 or L2), latency in ms, and the decision **trace** as a step list. Replies are also spoken (Piper audio if available, else `speechSynthesis`) with a mute toggle.
5. **Devices panel**: visual light bulbs per device (glowing when ON), thermostat value, a "flip physical switch" button per device (manual toggle), and a "controller unreachable" toggle.
6. **"What still works" panel**: from the Atlas, three groups (Available / Verify before claiming / Unavailable) that change with the mode. Each row shows a small "tested / not tested" tag.
7. **Queue and reconcile panel**: pending queued commands with timestamps, and after recovery a **reconcile report** showing replayed vs dropped-as-stale with reasons.
8. **Timers panel**: active timers with countdowns, alarm state, stop button.
9. **Event log**: scrolling live log of mode changes, decisions, device events.
10. **Demo mode panel**: a guided **4-stage storyboard** (1 ONLINE -> 2 OFFLINE -> 3 OFFLINE -> 4 RECOVERING) with a "Next step" button that sets up the state and highlights the exact line to say. Stage lines from the deck: "Turn on the hallway light" (online, both paths available) -> "Turn off the hallway light" (offline, "Offline mode: local actions only") -> "Search for a pasta recipe" (offline, "I can't search the web right now") -> "Connection restored" (RECOVERING: "Reconciling queue, then cloud resumes"). Also a "Reset demo" button.
11. **Engine status strip**: honest indicators for Vosk, Piper, Ollama L2, device adapter (simulated vs real), probe mode.

Handle WebSocket reconnect automatically. The frontend itself must continue working when the sim internet is "down" (it only talks to the local backend). Keep it accessible (contrast, focus states, keyboard usable).

---

## 6. EVALUATION HARNESS (`backend/eval/`)

Build the harness exactly as the deck's "How we will measure it" slide describes.

- `commands.csv` with **60 commands** in this mix: **Lights 20, Cloud-only 15, Timers 10, Invalid/unsafe 10, Recovery 5**. Include English and Hinglish lights commands, paraphrases that need L2, and cloud-only phrasing variants. Columns: `id,text,category,mode,expected_route,expected_intent`.
- `run_eval.py`: runs every command through the router in-process (no HTTP needed), setting the mode as specified per row (ONLINE/OFFLINE), and writes:
  - **Test log CSV**, one row per command: `id, text, expected_route, actual_route, pass, ms`
  - **Metrics JSON + a markdown report** with: `offline_success = passed / supported`, `refusal_rate = correct_refusals / unsupported`, `latency p50 and p95 (ms) per route`, `recovery = right_final_state / reconnect_trials`, plus a breakdown by category, parser layer (L1 vs L2) and a list of failures.
  - Recovery trials: 5 scripted scenarios of reconnect with stale queue entries, checking the final device state.
- The report must state which parser layers were active (e.g. "L2 unavailable in this run"), and print real numbers only. If L2 is unavailable, report separately so numbers are not misleading.
- `make eval` runs it. Do not hard-code or fake any result.

---

## 7. TESTS (`backend/tests/`)

Write pytest tests covering at minimum:
- State machine transitions and hysteresis (3 failures to go OFFLINE, 1 success to RECOVERING, no flapping).
- Layer 1 parsing for English, Hinglish, Devanagari, durations, fuzzy typos.
- Layer 2 fallback behavior when Ollama is down (mock it), and with a mocked valid and invalid JSON response.
- Validator rejects hallucinated devices/intents and out-of-range params.
- Router decision order and exact reply templates in each mode.
- Cloud-only requests offline are explained, never silently dropped.
- Queue durability across DB reopen.
- **Stale-replay scenario** (10:05 / 10:10 / 10:20) drops the stale OFF and logs it.
- API tests via httpx for `/api/command`, `/api/internet`, `/api/state`, and a WebSocket event test.
- Unsafe/confirm flow.

All tests must pass. Run them yourself and fix failures.

---

## 8. DOCS AND DEV EXPERIENCE

- **README.md**: what it is, the problem (cloud failure silences the whole home, citing the deck's facts: Amazon ended local voice processing on some Echo models in Mar 2025, and the AWS US-EAST-1 outage hit Alexa in Oct 2025), the idea, architecture diagram (ASCII/Mermaid), quickstart (3 commands max), env vars table, how to enable optional Vosk/Piper/Ollama, how to run tests and eval, demo steps, honest **Limitations** section (prototype, simulated outage by default, hardware adapters untested, timers are software, not a change to Amazon's Alexa), and the roadmap (Now / Next / Later from the deck: Raspberry Pi 5 + real bulb, Home Assistant/MQTT/Matter, offline timers, Hindi + Hinglish expansion, quantized models on Echo-class chips).
- **docs/DECISIONS.md**: the decision log table from the deck (Speech-to-text: Vosk; Intent engine: rules first, small LLM second; Model output: fixed function-call schema; State store: SQLite; Backend: FastAPI; Device layer: adapter interface) with chosen, rejected, deciding factor, plus any extra decisions you made.
- **docs/ARCHITECTURE.md** and **docs/DEMO_SCRIPT.md** (the 4-stage script with timing and what to say).
- **Makefile** targets: `setup`, `dev`, `build`, `run` (serves everything on one port), `test`, `eval`, `clean`. Also `scripts/dev.sh` and `scripts/dev.bat`.
- **`.env.example`** documenting every variable.
- Pin sensible dependency versions. `requirements.txt` must install cleanly without Vosk/Piper/Ollama (those go in `requirements-optional.txt`).

---

## 9. BUILD AND VERIFY PROCESS (follow this order)

1. Scaffold the repo and install dependencies.
2. Build the backend core (models, atlas, db, connectivity, devices) and test it.
3. Build the parser (L1, L2 with fallback, validator) and test it.
4. Build router, sync/reconcile, timers, cloud sim, API and WebSocket, and test them.
5. Build the speech wrappers with fallbacks.
6. Build the frontend, then `npm run build` to confirm it compiles with no errors.
7. Build the 60-command eval set and harness, and run it.
8. Write all docs.
9. **Run the complete verification yourself:** `pytest` passes, `make eval` produces real results, backend starts, frontend builds, and an end-to-end smoke test via `curl` or a script walks the 4-stage demo: online light on, simulate outage, offline light off (local works), offline recipe search (honest refusal), restore, reconcile.
10. Fix anything that fails and re-run until everything is green.

---

## 10. QUALITY BAR

- Type hints everywhere in Python; docstrings on public functions; clear logging.
- No secrets in code. No required internet access at runtime for the local path. No telemetry.
- Code is modular, readable, and commented where the design is non-obvious (especially router order, hysteresis, and reconcile logic).
- The demo must be **reliable**: the simulated outage toggle, the guided storyboard, and Reset must work every single time.
- If a package or model cannot be installed in this environment, keep going with the fallback and document it. Do not block on optional components.

---

## 11. FINAL OUTPUT

When done, print a concise summary containing:
1. The exact commands to install and run the project.
2. The URL to open.
3. The test results (pass counts) and the real eval metrics from `make eval`.
4. Which optional engines (Vosk, Piper, Ollama) were active vs. using fallbacks.
5. Any assumptions or decisions you made, and anything I should do manually (for example `ollama pull qwen2.5:1.5b`).

Begin now. Build the whole project.
