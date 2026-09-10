# 12 — Known Issues

> Objective inventory of technical debt, dead code, hardcoded values, limitations, and scalability concerns observed in the current codebase. **No solutions are proposed** — this only documents the present state. Each item cites file paths.
>
> **Audited and corrected 2026-09-07.** Much of the original list had already been
> fixed by the workspace-config refactor but was still documented as broken, which
> is worse than no doc — it sends people to "fix" working code. Resolved entries
> were removed rather than annotated; what remains below was verified against the
> code on that date.

---

## Dead / orphaned code (present but not wired into runtime)

*Empty as of 2026-09-07.* The three orphaned files this section used to list
(`collectors/git-collector.js`, `backend/populate-sample-data.js`,
`metrics/agent-network.json`) no longer exist — see ROADMAP item 2.4. The three
unused dependencies (`node-cron` and `chokidar` in the backend,
`react-force-graph-2d` in the frontend) and their imports were removed on
2026-09-07. Note `chokidar` remains a **real** dependency of `collectors/` — the
watcher there is load-bearing.

---

## Static / non-functional data

| Item | Location | Observation |
|---|---|---|
| Orphaned test metrics | [metrics/tests.json](../../metrics/tests.json) | **No collector writes it and no page reads it.** There is no `Testing.tsx` and no Testing route — the file is a leftover seed. Harmless, but the backend still lists it in `METRICS_PLACEHOLDERS` and serves it at `/api/metrics/tests`. |
| Agent `progress`/`runtime` | [collectors/index.js](../../collectors/index.js) `collectAgents()` | Always emitted as `0`; never computed. The UI renders both. |
| `weeklyTrend` | `tokens.json` / `costs.json` | Always `0` — not computed (only daily `trend` is). Needs 14 days of history to compute; only a 7-day window is derived. |

---

## Hardcoded values

| Value | Location | Note |
|---|---|---|
| Frontend `WS_URL = ws://localhost:3001/ws` | [realtime.tsx](../../frontend/src/lib/realtime.tsx), [useAgentNetwork.ts](../../frontend/src/lib/useAgentNetwork.ts) | Overridable only via a `window.__SYNAPSE_WS_URL__` global. Does not follow the backend's `PORT`. |
| Agent display-name → gradient maps | [Overview.tsx](../../frontend/src/pages/Overview.tsx), [Team.tsx](../../frontend/src/pages/Team.tsx) | Keyed on specific agent display names; an agent not in the map falls through to a default. Repo colors are **no longer** hardcoded — `frontend/src/lib/repo-color.ts` hashes the name into a palette. |
| `ACTIVE_THRESHOLD_MS = 10 min` | collectors/index.js | Working-detection window. |
| Broadcast debounce `300ms`, `awaitWriteFinish 300ms`, poll default `15s`, backoff `500ms/10s` | server.js / collectors/index.js / hooks | Timing constants inline. |

**Resolved 2026-09-07 (do not re-report):** `CLAUDE_DIR` and the `GIT_REPOS`
fallback are gone — both now resolve through `shared/workspace-config.js`, so no
machine-specific path remains in source. `REPO_PRIMARY_AGENTS` is derived from
`config.repoAgents`. Backend `PORT` now honours `process.env.PORT`. Pricing was
already config-driven (`config.pricing`, defaulting to Sonnet 4.6); the real
defect was that `metrics/config.json` declared no `pricing` block while the
machine ran `opus[1m]`, understating cost by 1.67x — an Opus 5 block was added,
and `PRICING` is now refreshed per poll instead of snapshotted at module load.

---

## Configuration inconsistencies

| Item | Observation |
|---|---|
| Two config stores for one settings page | SQLite (`backend/data/synapse.db`) is source of truth for the 8 fields the Settings UI knows; `metrics/config.json` is a generated mirror, but is also read **directly** by `shared/workspace-config.js` for everything else (`pricing`, `joeruKitDir`, `repoAgents`, `workspace`). Hand-editing `config.json` therefore changes collector behaviour immediately while the Settings page keeps showing SQLite's copy of its own fields until saved. |
| Docs vs implementation drift | README/PROJECT_DESCRIPTION describe **polling** and **shadcn/ui**; the code uses **WebSocket push** and hand-written Tailwind. PROJECT_DESCRIPTION lists "WebSocket real-time updates" as a *future* item though it is already implemented. |

**Resolved 2026-09-07 (do not re-report):** the `weeklyBudget` 50-vs-200 mismatch
is gone (both are 50). The DB-unavailable branch of `GET /api/settings` now
returns the budget keys, so the response no longer changes shape with DB state.
`initializeMetrics()` placeholders now use each collector's real shape instead of
`{ data: [] }`. The three-unsynchronized-repo-lists item no longer applies — the
graph and the git collector both read `config.repositories`.

---

## TODOs / comments in code

- No `TODO`/`FIXME` markers remain. The two former notes referenced files/identifiers
  that no longer exist, and the `electron/main.js` icon pointing at a nonexistent
  `assets/icon.png` was removed on 2026-09-07 (the window now uses the default icon;
  there is still no icon asset in the repo, so packaging will ship unbranded).

---

## Limitations (functional)

- **Single-user, single-machine, local-only.** No auth, no remote access, no multi-user support (by design).
- **Binary agent status** (Working/Idle) — no Reviewing/Testing/Error produced by the collector though the UI has styles for them.
- **Working detection is repo-directory based** — co-owning agents both light up for the same repo; the collector cannot disambiguate which agent is actually active (e.g. AI Chatbot Engineer + Frontend Engineer both own `chat-widget`).
- **Task board is read-only in the UI except for status** — no create, delete or
  edit from Synapse; those writes still happen in the board file, by agents.
  Status is now changeable (`POST /api/tasks/:id/status`), which is what lets
  Assistant Mode complete a task by voice. See 05-task-system.md.
- **No historical data** — only current state is stored; no time-series persistence beyond the 7-day token window derived live from transcripts.
- **Two WebSocket connections per client** to the same `/ws` endpoint (metrics hook + graph hook).
- **Git introspection depends on `git` being on the collector's PATH.** `collectGit()` catches the spawn failure and logs it to the collector console only, so a missing or newly-installed git shows as an empty Git page with no in-app error. A collector started before git was installed keeps failing until restarted.

*Resolved 2026-09-07: `claude.size` used `statSync(dir).size` — the directory entry size, not the tree — and now walks recursively.*

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
