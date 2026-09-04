# SenJoeru Synapse — Roadmap

Version: 1.0
Status: Active plan
Governed by: [ARCHITECTURE-V2.md](ARCHITECTURE-V2.md)

> **This roadmap replaces** the old `PHASE-2-Orchestration-Layer.md` and `PHASE 3 — Execution Intelligence Layer` docs (removed). Those pushed Synapse toward *driving* Claude (orchestration / auto-dispatch / RAG), which conflicts with its purpose. This plan keeps Synapse a **read-only observer** and grows it into a full engineering Mission Control — without ever running Claude and without burning tokens.

---

## Identity (what Synapse is — and is not)

- ✅ A **local-first, read-only Mission Control** that **observes, remembers, and explains** your engineering work across your FlowerStore repos.
- ✅ **Zero-token**: it reads files + git + SQLite. It does not call an LLM (unless a step is explicitly opted-in and marked `[TOKENS]`).
- ❌ Not a chat client, not an IDE, not a code generator, and it **never drives or edits** Claude or your repos.

There are **two independent tracks**:
- **Track A — Synapse phases** (this app: Phases 1–6 below).
- **Track B — Agent improvement** (your `.claude/agents/*.md` — a *separate* effort; see bottom). Synapse only *displays* the results of Track B; it never runs the agents.

---

## Implementation Rules for AI (read before building ANY phase)

These rules exist to **minimize tokens and mistakes** during implementation. Every task in every phase must obey them.

1. **Follow the proven Phase-1 recipe, every time — do not invent new patterns:**
   `migration (backend/lib/db.js)` → `repository (backend/repositories/)` → `service (backend/services/)` → `route (backend/routes/)` → `wire in backend/server.js` → `test (node --test)` → `verify`.
2. **Additive only.** Never alter or break Phase-1 tables or existing endpoints. New migrations only *append* new tables. No breaking changes.
3. **Zero-token by default.** No LLM/embedding calls. Any step needing tokens must be tagged `[TOKENS]` and be opt-in/off-by-default.
4. **Observer-only.** Never write to `C:\Users\joelr\.claude\` or to any repo. Read-only. SQLite is the only thing Synapse writes.
5. **One entity / one feature per task.** Small scope = small context = fewer tokens = fewer mistakes.
6. **Every task ends green** with these exact checks:
   - backend: `node --check <file>` and `cd backend && node --test`
   - frontend: `cd frontend && npx tsc --noEmit`
7. **Search = SQLite FTS5** (built-in, local, free). **Not** embeddings/RAG. (This is the answer to the earlier RAG confusion — no vectors needed.)
8. **Reuse before create.** Reuse existing repositories/services/UI components and the `useTasks()`/`db:update` patterns rather than duplicating.
9. **Ownership (ARCHITECTURE-V2):** SQLite = source of truth; one owner per entity; runtime JSON stays disposable cache; `.claude/*` is read-only input.
10. **Detailed build spec is written per-phase, at implementation time** — NOT all upfront. When we start a phase, we generate a short task list with exact files + acceptance + verification for *that phase only*. (Writing all specs now would waste tokens and go stale.)
11. **Track progress**: update `C:\Users\joelr\.claude\tasks.json` + project memory as work completes.

---

## Phase overview

| # | Phase | Mission (one line) | Token cost | Status |
|---|---|---|---|---|
| 1 | **Data Foundation** | Permanent local storage (SQLite) | Zero | ✅ **Done** |
| 2 | **Observation** | Know *what is happening* — and remember it | Zero | ✅ Mostly done (2.5 doc pending) |
| 3 | **Engineering Intelligence** | *Explain* what happened (recaps, relationships) | Zero (opt-in AI later) | ✅ Core done (3.3/3.4 deferred) |
| 4 | **Knowledge Layer** | *Remember* decisions, notes, docs, agent memory | Zero (FTS5 search) | ✅ **Done** |
| 5 | **Insights & Analytics** | Show *what to improve* (velocity, health, cost) | Zero | ✅ **Done** |
| 6 | **Workspace Experience** | Make it a joy to use (nav consolidation, unified Team, timeline, session replay, heatmaps) | Zero | ✅ Done (co-change dep explorer deferred — needs collector file-lists) |

Guiding sequence idea: each phase is shippable on its own; do them in order, but Phase 6 (UX polish) can be pulled forward in slices whenever a page needs love.

---

## Cross-Cutting Concerns (apply across all phases)

These are not phases — they are ongoing responsibilities that matter because Synapse now holds **permanent** data.

### C1 — Data Safety (backup & export) ✅ implemented (2026-07-27)
SQLite (`backend/data/synapse.db`) is the permanent source of truth. Now protected:
- **Auto-backup + backup-before-migration:** `backupDatabase()` in `backend/lib/db.js` runs on startup *before* migrations (WAL-checkpointed copy → `backend/data/backups/`), keeps the last 15, and skips if a backup <10 min old (no spam on nodemon reloads).
- **Export:** `GET /api/backup/export` returns a consistent `.db` copy (WAL-checkpointed) for download.
- Remaining (optional): a UI button in Settings that hits the export endpoint.

### C2 — Packaging (`electron-rebuild`) 🟡 operational
`better-sqlite3` is a native module — it works in `npm run dev` (system Node) but must be **rebuilt for Electron's ABI** to work in a packaged `.exe`.
- Add the electron-builder native-rebuild step + `asarUnpack` for `better-sqlite3` when we first cut a distributable.
- **Deferred until you actually build a distributable** — verify against a real build, don't configure blind. No effect on `npm run dev`.

### C3 — Privacy & Local-Only 🟡 conscious choice
Your tasks/transcripts contain **real FlowerStore customer data** (order numbers, messages, PII). As Phases 3–4 index docs/transcripts and show recaps, that data flows through Synapse's DB.
- **Stays 100% local** — no cloud, no external calls (matches the zero-token, local-first principle). This is the privacy guarantee.
- The backend has **no authentication** — acceptable because it binds `localhost` only; do **not** expose the port to a network without adding auth.
- If any `[TOKENS]` AI feature is ever enabled (opt-in), it would send content to a provider — flag that clearly at that point.

### C4 — Performance note (known constraint) ⚪ minor
The token collector re-scans all transcript `.jsonl` files every poll; as history grows this can slow down. Not urgent — optimize with incremental/watermarked reads later if it becomes noticeable.

### C5 — Cross-track dependency ⚪ sequencing
Synapse **Phase 4.3 (per-agent memory view)** depends on **Track B.6 (agents writing `*.memory.md`)** existing first. Do Track B.6 before Phase 4.3.

### C6 — Workspace Portability 🟢 backend done (P0–P2), frontend pending (P3–P4)
Synapse was hardcoded to the FlowerStore workspace (paths, repo names, agent roster, pricing, branding — full audit + phased plan in [WORKSPACE-PORTABILITY.md](WORKSPACE-PORTABILITY.md)). **Backend/collector now fully config-driven (2026-07-28):** new `shared/workspace-config.js` loader is the single source of truth (reads `metrics/config.json`, defaults `claudeDir`→`<home>/.claude`, pricing→Sonnet 4.6); `shared/agent-repos.js` became a loader over `config.repoAgents`; collector/server/graph-builder/insights/intelligence all de-hardcoded; Joel's FlowerStore specifics moved into his `config.json` (verified byte-identical mapping, 63/63 tests). **Rule going forward:** every new feature reads workspace specifics from config — never hardcode a repo/role/path/brand. **Remaining:** P3 (frontend color/role/locale/branding de-hardcode + `/api/workspace` + `useWorkspace()`) and P4 (first-run onboarding, README, strip residual branding).

---

## Phase 1 — Data Foundation ✅ DONE

Permanent SQLite store, migrations, repository/service pattern, tasks + append-only history, projects/repositories/workspaces, settings, analytics/token/cost/execution history, live `db:update` WebSocket, History page. Full record: [PHASE-1-Data-Layer.md](PHASE-1-Data-Layer.md) · [PHASE-1-SUMMARY.md](PHASE-1-SUMMARY.md).

---

## Phase 2 — Observation

**Mission:** Mission Control always knows *"what is happening?"* — and keeps a permanent record of it, not just a live snapshot.

**Reality check:** Synapse already observes a lot live (git, sessions, agents, tasks, activity, tokens). Phase 2's real job is to **persist that observation into SQLite as history** and **clean up dead code** — small, low-risk, reuses Phase-1 patterns.

**Milestones**

| ID | Deliverable | New table(s) | Notes |
|---|---|---|---|
| 2.1 | **Repository observation → SQLite** | `repo_snapshots` | Persist branch, ahead/behind, changed-file counts per poll so repo state has history (today it's live JSON only). |
| 2.2 | **Session history → SQLite** | `observed_sessions` | Record each Claude session seen in `.claude/sessions` (start/end, cwd, repo) so past sessions are queryable, not just current. Read-only. |
| 2.3 | **Agent activity history → SQLite** | `agent_activity` | Who was "working," where, and when — a timeline per agent. |
| 2.4 | **Cleanup** | — | Remove orphaned `collectors/git-collector.js`, `backend/populate-sample-data.js`, `metrics/agent-network.json`; fix the **Testing page** (it shows static sample data — either wire real data or remove the page). |
| 2.5 | **Observation completeness pass** | — | Confirm every "what's happening" signal (branches, commits, file changes, sessions, agent status) is both live *and* persisted; document any gap (e.g. remote PRs are out of scope unless read via `gh` read-only later). |

**Acceptance:** every observed signal is persisted with history; dead code gone; Testing page no longer shows fake data; 100% zero-token; no Phase-1 regressions.

**✅ Implemented (2026-07-27):** migration 004 added `repo_snapshots`, `observed_sessions`, `agent_activity`; `ObservationRepository` + `ObservationService` (append-on-change / upsert-then-mark-ended, idempotent) snapshot git/sessions/agents into SQLite on startup + every collector poll; read endpoints `GET /api/observation/{repos,sessions,agent-activity}`. Cleanup done: removed orphaned `collectors/git-collector.js`, `backend/populate-sample-data.js`, `metrics/agent-network.json`; reset `metrics/tests.json` to empty so the Testing page shows an honest empty state. Verified: 39/39 backend tests (4 new); real-data smoke = 3 repo snapshots + 1 session + 10 agent rows, idempotent. **Pending: 2.5** (a Mission Control UI to view this history — a Phase 6 slice — and a short completeness note).

---

## Phase 3 — Engineering Intelligence

**Mission:** Move from *showing* data to *explaining* it — using plain computation (no AI needed).

**Milestones**

| ID | Deliverable | How (zero-token) |
|---|---|---|
| 3.1 | **Daily / session recap** | Aggregate the day's commits, task moves, files changed into a readable summary card. Pure counting/grouping. |
| 3.2 | **"What's active / what's blocked"** | Derive from tasks (status) + git (recent activity) which project/repo is moving vs stalled. Rules, not AI. |
| 3.3 | **Co-change analysis ("files that change together")** | Compute from git history which files/repos change in the same commits → relationship hints. Pure computation. |
| 3.4 | **Repository relationships** | Map obvious cross-repo links (shared branch names, the `shared/agent-repos` map, config) into a simple relationship view. |
| 3.5 | `[TOKENS]` **AI written summaries (optional, off by default)** | *If* you ever want natural-language recaps, add a provider-backed summarizer behind a setting. Deferred; not required for the phase. |

**Acceptance:** the dashboard answers "what happened today / this session," "what's blocked," and "what changes together" — all zero-token. Any AI summary is opt-in and clearly separate.

**✅ Implemented (2026-07-27) — 3.1, 3.2 + repo-activity:** `IntelligenceRepository` + `IntelligenceService` (pure computation over `tasks` + `execution_history`, no new tables — derived on read); `GET /api/intelligence/summary`; new **Intelligence page** (nav + `/intelligence`) showing Today recap (commits + completions), Active now (working tasks + agents), Needs attention (failed + stalled), and Repository activity (last commit → active/quiet/stale). Verified: 47/47 backend tests (4 new); frontend tsc clean; real-data smoke computed correctly. **Deferred: 3.3 co-change + 3.4 repo relationships** (need per-commit file lists — a small collector addition first); **3.5 AI summaries** stays opt-in/off.

---

## Phase 4 — Knowledge Layer

**Mission:** Become your engineering memory — decisions, notes, docs, and (crucially) **display per-agent memory** produced by Track B.

**Milestones**

| ID | Deliverable | New table(s) | Notes |
|---|---|---|---|
| 4.1 | **Notes / Decisions / ADRs / Bookmarks** | `notes`, `bookmarks` | CRUD + UI. Synapse-owned (ARCHITECTURE-V2 already lists these). You write engineering knowledge here. |
| 4.2 | **Docs index (read-only)** | `doc_index` | Index markdown/docs found in your repos (path, title, headings) so they're browsable/searchable — read-only, never edited. |
| 4.3 | **Per-agent memory view** | `agent_memory_index` | Read the memory files produced by Track B (`.claude/agents/*.memory.md`) and display each agent's accumulated knowledge. **Observe-only** — Synapse shows it, the agents own it. |
| 4.4 | **Full-text search (FTS5)** | FTS5 virtual tables | Search across notes, docs, tasks, memory, history **by keyword** — local, free, **no embeddings/RAG**. |

**Acceptance:** you can capture notes/decisions, browse indexed docs, see each agent's memory, and keyword-search all knowledge — zero-token, no vector DB.

**✅ Implemented (2026-07-27) — 4.3 + Track B.6 (the team-improving part):** created per-agent memory files for the busy agents (`backend-engineer.memory.md`, `ai-chatbot-engineer.memory.md`, seeded with real durable gotchas) — the agents now recall instead of re-derive. Synapse side: migration 006 `agent_memory` + `AgentMemoryRepository` + `TeamService` + `GET /api/team` + a **Team page** (10 named agents, model badges, live memory).

**✅ Implemented (2026-07-28) — 4.1, 4.2, 4.4 (Phase 4 COMPLETE):** migration 007 (`notes`, `bookmarks`, `doc_index`); `NotesService`/`BookmarkService` (CRUD), `DocIndexService` (bounded markdown scan of monitored repos → 14 docs), `SearchService` (**SQLite FTS5**, rebuild-on-search across notes+docs+tasks+agent_memory+execution_history, LIKE fallback); routes `/api/notes` `/api/bookmarks` `/api/docs` `/api/search`; new **Knowledge page** (search bar + Notes CRUD + indexed-docs browser + Bookmarks). Verified: 59/59 backend tests (8 new); frontend tsc clean; FTS5 confirmed available; real search e.g. "deadlock" → task + agent-memory hits. **No embeddings/RAG — keyword search only, as decided.**

---

## Phase 5 — Insights & Analytics

**Mission:** Turn the accumulated history into "what can we improve?" — all computed from SQLite (zero-token).

**Milestones**

| ID | Deliverable | Source |
|---|---|---|
| 5.1 | **Engineering velocity** | tasks completed over time, cycle time (from `tasks` + `execution_history`). |
| 5.2 | **Repository health** | activity, churn, hot files (from `repo_snapshots` + co-change). |
| 5.3 | **AI usage & cost trends** | deeper views on `token_history`/`cost_history` (per project/day/agent). |
| 5.4 | **Time & session analytics** | session durations, active hours (from `observed_sessions`). |

**Acceptance:** an Insights page with velocity, repo health, cost trends, and time analytics — all from local data.

**✅ Implemented (2026-07-28):** `InsightsRepository` + `InsightsService` (zero-token, derived on read from execution_history/token_history/repo_snapshots/observed_sessions) — velocity (completed + commits/day, zero-filled 30d), repo health (commits/changes/last-commit per repo), cost trend (daily tokens+cost + totals), session analytics (count/active/avg-duration/active-hours). `GET /api/insights/summary`; new **Insights page** (stat cards + velocity ComposedChart + cost AreaChart + repo-health list + active-hours BarChart, via recharts). Verified: 63/63 backend tests (4 new); frontend tsc clean; real smoke = 25 done / 34 commits / $237.46 / repo health correct.

---

## Phase 6 — Workspace Experience

**Mission:** Make Mission Control genuinely nice to use. Pure frontend on top of existing APIs — no new backend needed.

**Milestones:** unified **timeline**, **dependency/relationship explorer**, **global search UI** (over FTS5), **session explorer/replay** (walk a past session's activity), **heatmaps** (activity by repo/day), better **filters** and **dashboards**. Ship these as small independent slices.

**Acceptance:** the app feels like a polished engineering command center; every view reads existing data; zero-token.

### Slice 6.1 — Navigation consolidation + unified Team ✅ (2026-07-28)

Audited the 14 tabs and removed redundancy so the workspace reads like one coherent command center instead of overlapping views. **14 tabs → 10.**

| Removed tab | Folded into | Why |
|---|---|---|
| **Agents** (live status from metrics WS) | **Team** | Same roster shown twice; Team now carries persona **and** live status |
| **Analytics** (7-day token/cost from JSON) | **Insights** | Insights is the superset — 30-day SQLite history, velocity, repo health, sessions |
| **Activity** (rolling JSON feed) | **History** | History is the durable timeline; Overview already surfaces recent activity |
| **Testing** (empty) | — | No real test-data source after sample data was removed |

**Unified Team page** (`frontend/src/pages/Team.tsx`) is now the single "my AI engineers" view: avatar + persona (name/title/model/slug), **live status** (Working + active repo, pulsing dot) sourced from `metrics.agents`, **workload** (assigned + active task counts) from the SQLite task store, and each agent's **memory**. Overview "View All" links repointed (`/agents→/team`, `/activity→/history`). Deleted the 4 retired page files. `tsc --noEmit` clean; backend untouched (63/63).

### Slice 6.2–6.5 — Explorer, session replay, heatmaps, ownership ✅ (2026-07-28)

- **6.2 Unified timeline + filters** — History is now a **tabbed explorer** (`frontend/src/pages/History.tsx`). The Timeline tab has type chips (All / Commits / Tasks done, with live counts) + a text filter over title/detail/entity.
- **6.3 Session explorer + replay** — new **Sessions** tab lists every observed Claude session (`GET /api/observation/sessions`): repo, cwd, duration, active/ended, kind. Selecting one **replays** it — all commits + task completions that fall inside that session's `[first_seen_at … ended_at]` window, on a vertical timeline, plus session metadata (PID/kind/version/duration).
- **6.4 Activity heatmap** — GitHub-style calendar on Insights (commits + completions per day, 4-level intensity). Backend: `insights-service` velocity series now also carries the full ISO `date` (additive; 63/63 tests still pass).
- **6.5 Repo ownership matrix** — Insights now shows a **repo × engineer** heat-matrix built from real task assignments (who has taken on work in which repo). *Note:* the original "which repos **change together**" (co-change) explorer still needs per-commit file lists from the collector — a backend change — so that specific view remains deferred; the ownership matrix is the frontend-feasible relationship view delivered instead.

**Acceptance met:** polished command center, 10 non-redundant tabs, every view reads existing data, zero-token. `tsc --noEmit` clean; backend 63/63.

---

## Workflow Enhancements (post-Phase-6)

Features that make Synapse *act like* a senior engineer's ops center, not just a viewer. Same rules: zero-token, observer-only, additive.

### Proactive Attention & Alerts ✅ done (2026-07-28)
Synapse now surfaces **"what needs YOU"** instead of waiting to be checked. `AttentionService` (zero-token, derived on read) computes a queue from SQLite tasks + budgets + cost metrics: **failed** tasks (high), **reviews** waiting, **stalled** Working/Pending (untouched ≥7d), and **budget** breaches (hourly/weekly ≥90% warn, ≥100% urgent). Surfaced as a **"Needs your attention"** panel at the top of the Overview, plus **desktop notifications** for new high-severity items (gated by the Settings → notifications toggle; pre-existing items never toast). `GET /api/attention`; 67/67 backend tests. Real smoke: 37 items (25 review, 10 stalled, 2 budget, 1 urgent).

**Next candidates:** AI-team reliability metrics (completion/rework/QA-catch rate) · CI/deploy/PR "is-it-green / what's-shipped" visibility · agent-memory maturity (seed remaining busy agents + health view).

---

## Track B — Agent Improvement (separate from Synapse)

> This is **not a Synapse phase.** It happens in `C:\Users\joelr\.claude\agents\` and improves how your Claude agents actually work — including **making them cheaper to run (fewer tokens)**. Synapse later *displays* the memory this produces (Phase 4.3), but never runs the agents.

**Goal (per Joel, 2026-07-27):** **keep all 10 agents** (no removals) and make them into a **PM-orchestrated, collaborative, cheaper-to-run** team. You talk to the Project Manager; it routes work to the right specialists.

Two meanings of "tokens" (don't confuse them):
- Synapse phases = **zero** tokens (never calls AI).
- Track B = reduce the **tokens the agents spend when they actually run**.

### How orchestration works in Claude Code (design constraint)

The **session you talk to is the orchestrator** — only it can launch specialist agents; a specialist agent **cannot** launch other agents (no nesting). So "PM handles my prompt then assigns agents" is implemented as: **make the main session default to PM behavior** (plan → delegate → integrate), guided by a routing playbook. It is also token-efficient — each specialist runs in its **own isolated context**, keeping the main session light.

### Where the orchestration lives (CLAUDE.md placement)

Claude Code merges CLAUDE.md files from the cwd **up through parent folders** + the global one. Use three layers:

| File | Holds |
|---|---|
| `~/.claude/CLAUDE.md` (global) | universal rules only (e.g. tasks.json rule) — leave mostly alone |
| **`d:\FlowerStorePH\CLAUDE.md` (FlowerStore root)** | ⭐ **the PM orchestration + routing map** — inherited by all 5 repos, does NOT leak into other projects |
| `d:\FlowerStorePH\<repo>\CLAUDE.md` (per-repo) | that repo's build/test/architecture facts only |

Agent definitions stay in `~/.claude/agents/*.md` (global). Putting orchestration at the **FlowerStore root** (not global) means it applies to all FlowerStore repos but leaves Synapse/other projects untouched — lower risk than editing global CLAUDE.md.

### Keeping CLAUDE.md stable (git) + what to put in each

**Why per-repo CLAUDE.md "disappears" on branch switch:** it's *committed on some branches but not others*, so git removes it when you check out a branch that lacks it. (Untracked files never vanish on switch.)

**Fix — pick one policy per repo:**
- **Option A — Local & stable (recommended for personal config):** make it git-ignored + untracked so it stays on every branch and never shows as "uncommitted":
  ```
  git rm --cached CLAUDE.md        # stop tracking (keeps file on disk)
  echo "CLAUDE.md" >> .gitignore   # or add to .git/info/exclude for zero committed footprint
  ```
- **Option B — Committed & shared:** commit it on the **base branch** (dev/master); all descendant branches inherit it. Shows as clean, not "uncommitted." Use only if the team should share it.

**The FlowerStore-root orchestration `CLAUDE.md` is outside every repo → immune to branch switches.** Only per-repo files need the fix above.

**Bootstrapping content — `/init` then refine:** run Claude Code's `/init` in a repo to auto-generate a baseline CLAUDE.md (build/test commands, structure). Then **add the critical rules `/init` misses** (the gotchas the agent must not get wrong, e.g. "fsweb is READ-ONLY", "live chatbot path is Mastra not openai/"). `/init` ≈ 80%; you add the 20% that matters.

**What each level should contain:**

| Level | Contents |
|---|---|
| Global `~/.claude/CLAUDE.md` | Universal rules only (e.g. tasks.json tracking rule). Keep lean. |
| FlowerStore root `d:\FlowerStorePH\CLAUDE.md` | PM orchestration + routing map; cross-repo conventions. |
| Per-repo `<repo>\CLAUDE.md` | Purpose (1 line) · exact build/test/run commands · key architecture & entry points · **critical rules & gotchas**. Bootstrap with `/init`, then add gotchas. |

### Memory Strategy — tuned for AI-assisted professional development

**Goal:** the AI behaves like it *already knows your projects* — no re-explaining, no wasted tokens. The professional approach is **lean memory, layered by scope, with as little to hand-maintain as possible.** More memory ≠ better; the number of layers doesn't burn tokens — **bloat and duplication do.**

**Recommended setup (best for your workflow):**

**Two core layers you keep (both lean):**
1. **`CLAUDE.md` = your team playbook** — the rules/conventions/gotchas every AI session must follow. Layered: global (universal) → FlowerStore-root (orchestration + cross-repo) → per-repo (build/test/architecture + the gotchas an agent must never get wrong). This loads on **every** session, so it's the one to keep tight.
2. **Project memory (`~/.claude/projects/<project>/memory/`) = long-term project knowledge** — Claude Code recalls relevant facts across sessions **automatically**. You barely manage it; you just let durable decisions/architecture truths accumulate. This is "the AI remembers the project."

**One optional layer, used sparingly:**
3. **Per-agent memory (`~/.claude/agents/<name>.memory.md`) — ONLY for your busiest specialists** (realistically `backend-engineer` and `ai-chatbot-engineer`). A short role cheat-sheet of recurring gotchas. The other 8 agents rely on CLAUDE.md + project memory — **no per-agent file**. Don't build a memory system for every agent; that's bureaucracy, not value.

**Keep-lean discipline (this is what makes memory *save* tokens instead of *cost* them):**
- Store **conclusions, not investigations** ("decided X because Y" — not the whole log).
- **One fact per line; each memory file fits on ~1 screen.** Prune stale/wrong entries.
- **No duplication** — a fact lives in exactly one layer. Project-wide facts → project memory / CLAUDE.md, never copied into every agent.

**How a pro uses it:** a tight playbook (CLAUDE.md) + accumulated project knowledge (auto memory) + a small cheat-sheet only where a role keeps hitting the same wall. Nothing more.

### Steps

| Step | Deliverable | Where / How |
|---|---|---|
| **B.1 — Orchestration (the front door)** ⭐ | You prompt → PM understands + plans → delegates to the right specialist(s) → integrates results | Add an "orchestration mode" section to the **global `CLAUDE.md`** so every session is PM-first and auto-routes; turn **`project-manager.md`** into the **routing playbook** (request type → specialist, hand-off order, when to add QA/review). |
| **B.2 — Routing map** | Clear rules for who does what | chatbot/prompt/flow → ai-chatbot-engineer; API/server/logic → backend-engineer (+db-admin if heavy DB); UI → frontend-engineer; tests → qa-engineer; audit → security-reviewer; deploy → devops-engineer; comms → cs-comms-writer; drawio→spec → flow-analyst; multi-repo/complex → PM plans in order. |
| **B.3 — Per-agent prompt optimization** (lean = cheap) | Tighten every `*.md`: clear responsibilities, "definition of done," hand-off rules, trimmed verbosity | Shorter system prompts = fewer input tokens on *every* invocation. Keep ALL agents; just make each sharp. |
| **B.4 — Right-size the model per agent** | Set `model:` to fit the job | Heavy model only for hard engineering (chatbot, backend); cheaper/faster model for simpler roles (comms, docs, flow analysis). Same quality, lower cost. |
| **B.5 — Scope tools per agent** | Give each agent only the tools it needs | Less tool-schema overhead + fewer wrong-tool turns. |
| **B.6 — Per-agent memory (OPTIONAL)** | **Only the busy agents** (`backend-engineer`, `ai-chatbot-engineer`) get a short `~/.claude/agents/<name>.memory.md` cheat-sheet; read at start, append a *curated* line at end | The other 8 rely on CLAUDE.md + auto project memory — no file. Follows the **Memory Strategy** above (lean, pruned, no duplication). Later surfaced read-only in Synapse Phase 4.3. |

### Token-reduction levers (summary)

| Lever | Why it saves tokens |
|---|---|
| PM orchestration + isolated specialists (B.1) | Each agent loads only its own scope; main session stays light |
| Shorter prompts (B.3) | Input tokens billed on every single invocation |
| Right-sized models (B.4) | Cheaper model for simple work = lower cost per token |
| Scoped tools (B.5) | Less schema overhead + fewer wasted wrong-tool turns |
| Per-agent memory (B.6) | Skip re-discovering the same context each run |
| Clear "done" + hand-offs (B.1/B.3) | Fewer clarification/retry turns |

**Guardrails:**
- **No agents are removed** — all 10 stay; we optimize in place.
- Editing the **global `CLAUDE.md`** affects *every* Claude Code session everywhere (not just FlowerStore) — treat it as a careful, reviewed change.
- True *autonomous dispatch* (Synapse launching agents itself) stays **out of scope** — agents orchestrating *inside* Claude Code is the model here.

**Recommended start:** **B.1 + B.2 (orchestration + routing)** — this is the capability you actually want (talk to PM, it assigns the work). Then B.3–B.6 optimize each agent for cost.

---

## How we'll implement (the token-saving method)

1. Pick the **next phase**.
2. I write a **short, exact build spec for that phase only** (files, acceptance, verify commands, "don't touch" list) — following the Recipe in the Implementation Rules.
3. We build **one milestone at a time**, each ending green (`node --check`, `node --test`, `tsc`).
4. Update `tasks.json` + memory; move to the next milestone.

This keeps each step small and mechanical, so implementation stays cheap and low-risk.

---

## Recommended next step

- **Track B.1 first** (upgrade one agent as a template) — highest real-world payoff for your FlowerStore work and it seeds the memory Phase 4 will display, **or**
- **Phase 2** (persist + clean up observation) — smallest, safest Synapse increment, pure reuse of Phase-1 patterns.
