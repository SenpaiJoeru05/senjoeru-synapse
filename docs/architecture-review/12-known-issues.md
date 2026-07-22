# 12 — Known Issues

> Objective inventory of technical debt, dead code, hardcoded values, limitations, and scalability concerns observed in the current codebase. **No solutions are proposed** — this only documents the present state. Each item cites file paths.

---

## Dead / orphaned code (present but not wired into runtime)

| Item | Location | Observation |
|---|---|---|
| Separate git collector | [collectors/git-collector.js](../../collectors/git-collector.js) | A second, standalone git collector with an **older output shape** (`{ data: [...] }`, raw `log.all`, POSTs to `/api/metrics/git`, its own `setInterval(10000)`, its own `REPOSITORIES` list). Not referenced by any npm script or by `electron/main.js`. The live git logic is `collectGit()` in `index.js`. |
| Sample-data seeder | [backend/populate-sample-data.js](../../backend/populate-sample-data.js) | One-off script that overwrites all metrics files with fake data (Backend Agent/QA Agent/etc.). Not invoked by any script; if run manually it clobbers real metrics. |
| Legacy graph data | [metrics/agent-network.json](../../metrics/agent-network.json) | Old graph representation (`x/y/connections/messageCount`) written by the seeder. **Read by nothing** — the live graph is built from `agents.json`+`tasks.json`. |
| `node-cron` import | [backend/server.js](../../backend/server.js) | Imported but no `cron.schedule` call exists. |
| `chokidar` (backend) | backend/package.json | Declared dependency, not used in `server.js`. |
| `react-force-graph-2d` | frontend/package.json | Installed but never imported (graph uses `@xyflow/react`). |

---

## Static / non-functional data

| Item | Location | Observation |
|---|---|---|
| Testing page data | [metrics/tests.json](../../metrics/tests.json), [Testing.tsx](../../frontend/src/pages/Testing.tsx) | **No collector writes test data.** `tests.json` is static sample data (last updated 2026-06-29) matching the seeder. The Testing page renders this seed indefinitely. |
| Agent `progress`/`runtime` | [collectors/index.js](../../collectors/index.js) `collectAgents()` | Always emitted as `0`; never computed. |
| `weeklyTrend` | `tokens.json` / `costs.json` | Always `0` — not computed (only daily `trend` is). |

---

## Hardcoded values

| Value | Location | Note |
|---|---|---|
| `CLAUDE_DIR = 'C:\\Users\\joelr\\.claude'` | [backend/server.js](../../backend/server.js), [collectors/index.js](../../collectors/index.js) | User-specific absolute path in two files. The Settings `claudeDir` field does not redirect the actual readers. |
| Backend `PORT = 3001` | backend/server.js | Not configurable via env. |
| Frontend `WS_URL = ws://localhost:3001/ws` | [realtime.tsx](../../frontend/src/lib/realtime.tsx), [useAgentNetwork.ts](../../frontend/src/lib/useAgentNetwork.ts) | Overridable only via a `window.__SYNAPSE_WS_URL__` global. |
| `GIT_REPOS` fallback (absolute `d:\FlowerStorePH\...` paths) | collectors/index.js | Baked-in default repo list. |
| `REPO_PRIMARY_AGENTS` map (5 repos + agents) | [shared/agent-repos.js](../../shared/agent-repos.js) | Graph repo set requires a code edit to change. |
| Repo/agent color maps + agent name strings | Overview.tsx, Tasks.tsx, Agents.tsx | The 5 repo names and specific agent display names hardcoded across UI. |
| `ACTIVE_THRESHOLD_MS = 10 min` | collectors/index.js | Working-detection window. |
| Broadcast debounce `300ms`, `awaitWriteFinish 300ms`, poll default `15s`, backoff `500ms/10s` | server.js / collectors/index.js / hooks | Timing constants inline. |
| Pricing = **Claude Sonnet 4.6** | collectors/index.js `PRICING`; Settings.tsx footer | Cost is always computed at Sonnet 4.6 rates regardless of the model actually used. The observed Claude `settings.json` `model` is `opus[1m]`, so cost figures may not reflect the real model's pricing. |

---

## Configuration inconsistencies

| Item | Observation |
|---|---|
| Three unsynchronized repo lists | Graph map (`ALL_REPOS`) vs collector git list (`config.repositories`/`GIT_REPOS`) vs Settings UI — a repo can be in one and not the others (e.g. `seller-page` is graph-known but not git-monitored). See [06-repositories.md](06-repositories.md). |
| Settings defaults differ from live file | Code default `weeklyBudget: 50`; live `config.json` has `200`. `GET /api/settings` defaults omit `hourlyBudget`/`weeklyBudget` entirely. |
| `initializeMetrics()` placeholder shape | Creates missing files as `{ lastUpdated, data: [] }`, which does not match the richer shapes collectors later write (`{ agents: [] }`, `{ tasks: [] }`, etc.). Harmless because readers are defensive, but the shapes are inconsistent. |
| Docs vs implementation drift | README/PROJECT_DESCRIPTION describe **polling** and **shadcn/ui**; the code uses **WebSocket push** and hand-written Tailwind. PROJECT_DESCRIPTION lists "WebSocket real-time updates" as a *future* item though it is already implemented. |

---

## TODOs / comments in code

- `collectors/git-collector.js`: `// Add more repositories as needed`.
- `collectors/index.js` `GIT_REPOS`: `// add/remove as needed`.
- `electron/main.js`: references `icon: path.join(__dirname, '../assets/icon.png')` — **no `assets/` directory exists** in the repo, so the icon path is unresolved.
- No `TODO`/`FIXME` markers found beyond the above informal notes.

---

## Limitations (functional)

- **Single-user, single-machine, local-only.** No auth, no remote access, no multi-user support (by design).
- **Binary agent status** (Working/Idle) — no Reviewing/Testing/Error produced by the collector though the UI has styles for them.
- **Working detection is repo-directory based** — co-owning agents both light up for the same repo; the collector cannot disambiguate which agent is actually active (e.g. AI Chatbot Engineer + Frontend Engineer both own `chat-widget`).
- **Task board is read-only in the UI** — no create/edit/complete from Synapse; all writes happen in `.claude/tasks.json`.
- **No historical data** — only current state is stored; no time-series persistence beyond the 7-day token window derived live from transcripts.
- **`claude.size` in health** uses `statSync(dir).size` (directory entry size, not recursive footprint) — misleading number.
- **Two WebSocket connections per client** to the same `/ws` endpoint (metrics hook + graph hook).

---

## Potential bottlenecks

| Area | Observation |
|---|---|
| Token collection | `collectTokens()` walks **every `*.jsonl`** under **every** project dir on **every poll** (default 5s), reading full file contents and JSON-parsing each `"usage"` line. Cost grows with total transcript volume and history size; there is no incremental/caching layer. |
| Task board re-parse | The ~100 KB `.claude/tasks.json` is fully read + parsed + re-serialized every poll and on every change event. |
| Full metrics snapshot on every frame | `readAllMetrics()` reads all 8 metrics files to build each `metrics:update` payload; broadcast is change-gated but the read happens each debounce cycle. |
| Watcher fan-out | A single change under watched `.claude/projects` (which Claude writes to constantly during active work) triggers a full 6-collector `poll()`. High Claude activity ⇒ frequent full re-collections (partially mitigated by `awaitWriteFinish` + broadcast dedupe). |
| Git introspection | `collectGit()` runs `git status` + `git log` per repo each poll via `simple-git` (spawns git processes). |

---

## Scalability concerns

- **Poll cost scales with transcript history, not just current activity** — the token walker reprocesses the entire `.claude/projects` tree each cycle; there is no watermark/offset to only read new lines.
- **Repo set is hardcoded** — supporting more repos/projects in the graph requires editing `shared/agent-repos.js` and UI color maps rather than configuration.
- **Single-project assumptions** — graph + git monitoring are FlowerStorePH-specific; token analytics are multi-project but the rest of the UI is not.
- **No pagination/limits on large collections** — activity capped at 20 (collector) / 200 (client) and commits at 5, but tasks and per-repo `files` arrays are unbounded and rendered in full.
- **In-memory dedupe only** — `lastPayloadStr`/`lastMetricsStr` live in the backend process; a backend restart re-broadcasts everything to all clients on reconnect.

---

## Security-relevant observations (state, not findings)

- The backend has **no authentication** and binds `localhost`; any local process can read metrics and **write** via `POST /api/metrics/:type` and `POST /api/settings`.
- The Claude directory is treated read-only by convention; the collectors only read it (the task-escape repair is done in memory, never written back).
- Electron is hardened (`contextIsolation: true`, `nodeIntegration: false`, no remote module), and the preload exposes only `getMetrics`/`getSystemInfo`/metrics-update listeners.
