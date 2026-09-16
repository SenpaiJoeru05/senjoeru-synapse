# Real-time agent status visibility (task 30)

> **Status:** proposed, not started. Written 2026-09-14 by the project-manager
> agent. Repos touched: `senjoeru-synapse` (backend + frontend) and `joeru-kit`
> (hook config, shipped to every Claude Code install via `joeru-kit build`).

---

## The gap, stated precisely

Joeru can already delegate — `Task` is granted (`electron/claude.js:330`,
`CAPABILITY_NOTE`), and his own definition says "delegate with the task tool,
never do a specialist's job yourself." When he does, the dispatched subagent
(`frontend-developer`, `backend-developer`, `dev-team-lead`, `Explore`, …) runs
for anywhere from seconds to several minutes, often in an isolated git
worktree. Right now that work is **completely invisible**: the parent
conversation shows a `Task` tool call go out and, eventually, a result come
back — nothing in between. Synapse's existing agent model (`04-agents.md`)
already documents the closest thing that exists today and why it doesn't cover
this:

> "Working detection is repo-directory based… the collector cannot tell which
> agent is actually running" and "progress and runtime are always 0 — never
> computed."

That detection is mtime-on-a-transcript, polled every 5–15s — a proxy for "an
agent replied recently," not "this specific subagent is doing X right now."
It cannot show a live tool-by-tool trace of a dispatched subagent because a
subagent's internal tool calls are not new OS processes or new session files
Synapse's file-watching collectors can see — they happen **inside** the
parent Claude Code process's own agentic loop.

**The fix has to originate from Claude Code itself**, not from watching files
harder.

---

## 1. Agent reporting mechanism

### The mechanism: Claude Code hooks, not a new protocol

Claude Code already has a first-party instrumentation point built exactly for
this: **hooks**. Verified against the official reference
(`code.claude.com/docs/en/hooks`, fetched 2026-09-14):

- `SubagentStart` fires the moment a subagent (Task-tool dispatch) begins.
  Payload: `{ session_id, hook_event_name: "SubagentStart", agent_type,
  agent_id }`.
- `PreToolUse` / `PostToolUse` fire for **every tool call the subagent makes**
  — Read, Write, Edit, Bash, Grep, Glob, WebSearch, nested `Task`, etc. — with
  the same `agent_id`/`agent_type` fields attached, distinguishing a
  subagent's tool calls from the main thread's. Payload adds `tool_name`,
  `tool_input`, `tool_use_id`, `cwd`.
- `SubagentStop` fires when it finishes, carrying `last_assistant_message`.
- `PostToolUseFailure` fires on a failed tool call.

This is precisely "what actions is it taking" (tool name + input, per call)
and "when does it finish" (`SubagentStop`), for free, from data Claude Code is
already generating — no polling, no guessing from mtimes.

### Transport: the built-in `http` hook type, not a script

Hook handlers support `type: "http"` — Claude Code itself POSTs the hook's
JSON payload to a URL, with **no script, no child process, no per-tool-call
overhead**:

```json
{
  "type": "http",
  "url": "http://localhost:3001/api/agent-events",
  "async": true,
  "timeout": 10
}
```

`async: true` is the load-bearing setting: the hook runs in the background,
Claude Code does **not wait** for it, and its timeout is not enforced. This
guarantees the one non-negotiable constraint — **a dispatched agent must
never be slowed down or blocked by Synapse being unavailable.** If the
backend is down, the POST fails silently and the agent proceeds exactly as if
no hook existed. This must be verified explicitly during implementation (stop
the backend, dispatch a subagent, confirm no behavior change — see §4).

### Where the hooks are configured

`~/.claude/settings.json` (user-global — every Claude Code session on the
machine, any repo), because "a background agent was dispatched" is not
scoped to one repo, and this machine already has global config precedent
(`.claude/agents/*.md`, the global `CLAUDE.md`). Today that file holds only
`{ theme, effortLevel, model }` (`docs/architecture-review/07-claude-integration.md:75`)
— no `hooks` block exists yet, so this is genuinely new ground, not an
extension of something already there.

**joeru-kit owns writing it**, the same way it already owns everything else
that reaches every Claude Code install (`bin/joeru-kit.js`'s `build()`
writes agents, skills, commands, and prints `claude mcp add-json` commands
for MCP). Add a `buildHooks()` step, modeled on `buildMcp()`'s
read-modify-write caution (`bin/joeru-kit.js:413-446`): read the existing
`~/.claude/settings.json`, replace only the `hooks` key (never touch
`theme`/`effortLevel`/`model`), write it back. Unlike the MCP case there is
no "print commands for the user to run" workaround needed — `settings.json`
is a small file Claude Code does not aggressively rewrite mid-session the way
`~/.claude.json`'s MCP registry does, so a direct merge is safe.

The endpoint base (`http://localhost:3001`) should live in `targets.json`'s
`paths` block (e.g. `paths.SYNAPSE_API`), following the exact pattern
`detectPaths()` already uses for `TASKS_FILE` (`bin/joeru-kit.js:600-625`) —
auto-detected when a `senjoeru-synapse` checkout is a sibling, overridable by
hand for the second laptop if the port ever differs.

### Required verification before building (a real STOP-and-check, not a formality)

`SubagentStart`/`SubagentStop` and `type: "http"` hooks are documented in the
current official reference, but the installed CLI version must actually
support them — a session file quoted in `07-claude-integration.md` shows
`"version": "2.1.186"`, which is plausibly current but not confirmed against
this exact feature set. **First implementation step: run `claude --version`
and dispatch one throwaway subagent with a minimal hook configured, and
confirm the hook actually fires** before building anything downstream. If the
installed CLI predates `type: "http"` or `SubagentStart`, the fallback is a
`type: "command"` hook running a two-line Node script that does the fetch
itself (`fetch(url, {method:'POST', body, signal: AbortSignal.timeout(500)}).catch(()=>{})`,
always `exit 0`) — same payload, same guarantee, one extra process per event.

### What gets reported, concretely

| Event | Fires | Fields used |
|---|---|---|
| `SubagentStart` | subagent begins | `session_id`, `agent_id`, `agent_type`, `cwd` |
| `PreToolUse` | before each tool call | + `tool_name`, `tool_input`, `tool_use_id` |
| `PostToolUse` | tool call succeeds | + `tool_use_id` (correlate with the Pre event) |
| `PostToolUseFailure` | tool call fails | same, marks the action failed |
| `SubagentStop` | subagent finishes | + `last_assistant_message` |

`PreToolUse` alone is enough to show "what it's doing right now" live;
`PostToolUse`/`PostToolUseFailure` upgrade that entry from "in flight" to
"done"/"failed" a moment later. Both are cheap, so take both rather than
inferring completion from the next `PreToolUse`.

---

## 2. Synapse reception & storage

### New ingest endpoint

`backend/routes/agent-activity.js` (new), mounted in `backend/server.js`
alongside the other route mounts (next to `/api/attention`, `~line 281`):

```js
app.post('/api/agent-events', (req, res) => {
  agentActivity.ingest(req.body);
  res.json({ ok: true });        // hook is async — body is never awaited by Claude Code
});
app.get('/api/agent-activity', (req, res) => {
  res.json(agentActivity.snapshot());   // initial paint, mirrors GET /api/agent-network
});
```

No auth, binds to the existing `localhost:3001` — consistent with the
project's stated model ("no authentication… trusts all local callers,"
`09-api.md:160`). No new trust boundary is crossed: the same tool-call detail
(full file paths, Bash commands, Edit contents) already lands on disk in
`.claude/projects/**/*.jsonl`, which the collector already reads in full —
this only changes the delivery mechanism from poll-a-file to receive-a-push
for the subset that matters (subagent-scoped events).

### Storage: in-memory, not SQLite — deliberately

`backend/services/agent-activity-service.js` (new). Keyed by `agent_id`:

```js
{
  agentId, agentType, sessionId, cwd, repo,       // resolved from cwd
  status: 'starting' | 'working' | 'done' | 'failed',
  startedAt, lastEventAt,
  current: { tool, detail, icon, at } | null,      // in-flight action, or null when idle/done
  recent: [ {tool, detail, icon, status, at}, … ], // capped ring buffer, last 5
  toolCallCount,
  lastMessage,                                     // last_assistant_message, truncated
}
```

This is a deliberate fit with the ownership model already written down in
`docs/roadmap/ARCHITECTURE-V2.md`'s ownership matrix: `Active Agent Status`
is explicitly `Owner: Collector Engine, Storage: JSON Cache, Persistent: No,
Regeneratable: Yes`. This is the same category — call it a sibling of the
collectors (an **Agent Event Receiver**, push-driven instead of poll-driven)
rather than a new SQLite table. Task 30's own constraint agrees: "show what's
actively happening NOW, not a full history." A restart loses in-flight state,
which is acceptable — the next events rebuild it, and nothing here is a
business record. (`AD-002`/`AD-003`/`AD-013` — collectors/runtime own
transient state, never business entities — extend cleanly to this new
component; it does not need a new architecture decision, it fits the existing
ones.)

Cleanup: a `done`/`failed` entry is kept for a short grace window (~60s, so
the user actually *sees* "finished" rather than it vanishing the instant the
last event lands) then dropped. `setInterval` for the sweep, `.unref()`'d —
matching the existing convention for the CPU sampler (`server.js:387`).

Per-event cost must stay cheap: no disk I/O per event (this is the opposite
of `metrics/*.json` — nothing here is written to a file), and `tool_input` is
reduced to a short derived label immediately on ingest rather than stored
verbatim — an `Edit` call's `old_string`/`new_string` can be large, and
keeping it in memory for every event serves no purpose the UI needs (see
detail-string derivation in §3).

### Real-time push to the UI: a new WS frame, not a new poll

`backend/server.js` already has exactly this pattern for two frames
(`metrics:update`, `agent-network:update`, `db:update`) — same broadcaster,
same `wss.clients`. Add a fourth: `agent-activity:update`. Unlike the other
three, this one should **not** wait for the collector's 300ms-debounced
`scheduleBroadcast()` (`server.js:692-740`), because that cycle is tied to
the collector's poll, and this is a genuinely independent, faster-moving
event source. Broadcast directly from the ingest handler with its own short
debounce (~100–150ms, to coalesce a burst of `PreToolUse`+`PostToolUse` pairs
without feeling laggy):

```js
let activityTimer = null;
function scheduleActivityBroadcast() {
  if (activityTimer) return;               // already scheduled, let it fire
  activityTimer = setTimeout(() => {
    activityTimer = null;
    broadcast(JSON.stringify({
      type: 'agent-activity:update',
      timestamp: new Date().toISOString(),
      agents: agentActivity.snapshot(),
    }));
  }, 120);
}
```

On `wss.on('connection')` (`server.js:827`), send one `agent-activity:update`
frame alongside the existing three, so a page opened mid-dispatch paints
immediately instead of waiting for the next event.

### Repo resolution

`cwd` on the hook payload is the subagent's actual working directory —
already exactly the value the existing repo auto-detect logic consumes
(`detectSessionGitRepos()`, `server.js:766`, and `agent-repos.js`'s
`REPO_PRIMARY_AGENTS`). Resolve `cwd` to a known repo the same way: exact
match, then nearest parent with a `.git`, then fall back to the `cwd`
basename so an unrecognized worktree path still renders as *something*
rather than a blank field.

### Test coverage

`backend/services/agent-activity-service.test.js` (node's built-in
`node --test`, matching every other `*.test.js` in this repo — this project
uses `node --test`, not Pest; Pest is fsweb/Laravel's tool and does not apply
here). Cover: start→tool→tool→stop lifecycle; a failed tool call marks the
entry failed without losing prior successful actions; TTL sweep actually
removes expired `done` entries; two parallel `agent_id`s never cross-contaminate;
an event missing `agent_id` (main-thread noise, if a hook is ever placed
broadly enough to catch it) is ignored rather than crashing the service.

---

## 3. UI design

### Icon + label derivation (shared, not duplicated)

`electron/claude.js` already solved "turn a tool call into something a human
reads at a glance" once, for the Chat/Assistant tool-activity strip (task 28
built `makeStreamReader`; task 25's `describeInput` reads both `filePath` and
`file_path`). Extract a small shared pure function —
`shared/describe-tool-call.js` — used by **both** the existing Electron-side
renderer and the new backend `agent-activity-service`, so the mapping only
exists once. (This project's own history has a name for what happens when it
doesn't: task 28's whole point was fixing exactly this kind of drift between
two parsers of the same event stream.)

Mapping (Lucide icon names — already the icon set in this stack):

| Tool | Icon | Label |
|---|---|---|
| `Read` | `file-text` | `Reading <basename(file_path)>` |
| `Write` | `file-plus` | `Writing <basename(file_path)>` |
| `Edit` | `pencil` | `Editing <basename(file_path)>` |
| `Bash` | `terminal` | `<command, truncated ~40 chars>` |
| `Grep` | `search` | `Searching "<pattern>"` |
| `Glob` | `search` | `Finding <pattern>` |
| `Task` | `users` | `Delegating to <subagent_type>` (nested dispatch) |
| `WebSearch` / `WebFetch` | `globe` | `<query or url>` |
| `TodoWrite` | `list-checks` | `Updating the plan` |
| anything else | `activity` | `<tool_name>` |

Agent display name reuses the existing `formatAgentName()` from
`collectors/index.js` (`04-agents.md:11`) so "frontend-developer" renders as
"Frontend Developer" identically everywhere in the app — one more place this
already exists and should not be reinvented.

### No fake progress bar

There is no reliable total-step count for a dispatched subagent, so a
percentage would be a number invented to look precise — exactly the failure
this codebase has already caught and rejected once (task 24: "a gauge
showing an idle machine while it is still measuring is a lie the consumer
cannot detect"). Use:

- an **indeterminate** animated bar/stripe while `status: working` (a
  direction, not a fraction),
- a live **tool-call count** ("14 actions so far") and **elapsed time**,
  which are both real and more informative than a guessed percentage,
- a solid state change on completion — green check for `done`, red mark for
  `failed` — not a bar filling to 100.

### Where it appears

**Both**, sharing one hook (`useAgentActivity()` in `frontend/src/lib/`,
mirroring the existing `metrics`/`agent-network` WS hooks: REST snapshot on
mount via `GET /api/agent-activity`, then apply `agent-activity:update`
frames), rendered differently per surface:

**Main dashboard — Agents page** (`frontend/src/pages/Agents.tsx`, currently
per-definition-file cards with binary Working/Idle — see
`04-agents.md`'s stated limitation). Add an "Active Dispatches" section above
or beside the existing roster:

```
┌─ Active Dispatches ──────────────────────────────────────────┐
│ ● Frontend Developer          fsweb · worktree-a3f2   4m12s   │
│   ✎ Editing ProductCard.vue                     [24 actions] │
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (indeterminate stripe)             │
│   recent:  read Card.vue → grep "CLS" → edit ProductCard.vue  │
│                                                                │
│ ✓ QA Specialist                fsweb          2m03s  finished │
│   "Verified 8/8 regression cases, no defects found."          │
└────────────────────────────────────────────────────────────────┘
```

Section is **absent entirely** when there are zero active/recently-finished
entries — not an empty placeholder card — matching the standing pattern
already set (task 20's "show what matters," task 24's null-vs-zero
discipline). A `done`/`failed` card fades out after its ~60s grace window.

**Assistant Mode window** (`frontend/` Electron renderer, `electron/main.js`'s
floating window). Two densities, following the width threshold task 23/24
already established for the HUD stats rail (≥700px reveals it):

- **Below 700px** (the 440px default): a single compact chip near the header,
  one line, showing only the *most recently active* dispatch — icon + agent
  name + current action, e.g. `⚙ Frontend Developer — editing ProductCard.vue`.
  Tapping it is out of scope for MVP; it's a glance, not a panel.
- **≥700px** (stats rail visible): a proper card in the existing HUD rail
  (`components/AssistantStats.tsx`), styled with the already-established
  `.glass`/`.glass-card`/`.neon-glow` tokens (task 23) so it matches the CPU/
  memory dial and spend sparkline already there rather than looking bolted
  on. Same content as the dashboard card, compressed: name, current action
  with icon, elapsed, tool count, indeterminate stripe.

Both surfaces poll nothing — same `useAgentActivity()` WS subscription,
consistent with how `AssistantStats` already gets its numbers pushed rather
than fetched (task 23 notes the *stats rail itself* was on a 15s poll because
that window renders before the app's realtime provider mounts — worth
checking whether this new hook needs the same workaround or can ride the
same WS connection Chat/Dashboard use; confirm during implementation rather
than assuming).

### Interaction

- Clicking/expanding a card reveals its `recent` trail (last 5 actions as a
  horizontal row of icon+label chips) — no navigation, no drill-down to the
  full transcript. Full history is explicitly out of scope per the task's
  own constraint.
- A finished entry's card shows `last_assistant_message` (truncated to ~150
  chars) as the "what it concluded" line — the one piece of the SubagentStop
  payload worth surfacing, since it answers "what happened" without opening
  a transcript.

### Optional, later: an Activity-feed entry

`collectActivity()` already synthesizes a capped 20-event timeline from
agents/tasks/git (`10-runtime.md`, `collectors/index.js`). `SubagentStart`/
`SubagentStop` could append "Frontend Developer started work in fsweb" /
"Frontend Developer finished (24 actions, 4m12s)" entries there too, giving a
light historical trace without turning the live cards into a log. Sequence
this after the core live view works — it's additive, not required for the
feature to be useful.

---

## 4. Implementation order

1. **Verify hook support on the installed CLI** (see §1's STOP-and-check).
   `claude --version`; hand-configure one throwaway `SubagentStart` +
   `PreToolUse` hook pointed at a `curl`/`nc` listener or a one-line HTTP
   echo server; dispatch a trivial subagent; confirm the events actually
   arrive with `agent_id`/`agent_type` populated. Do not proceed past this
   step on an assumption.
2. **`joeru-kit`**: add `buildHooks()` to `bin/joeru-kit.js`, a
   `paths.SYNAPSE_API` entry in `targets.json` (auto-detected in
   `detectPaths()`, alongside the existing `TASKS_FILE` detection), and a test
   in `test/build.test.js` proving the merge preserves existing
   `theme`/`effortLevel`/`model` keys and is idempotent (running `build`
   twice does not duplicate hook entries). Run `joeru-kit build`; confirm
   `~/.claude/settings.json` gained a `hooks` block and nothing else changed.
3. **`senjoeru-synapse` backend**: `shared/describe-tool-call.js` (the
   shared icon/label mapper), `backend/services/agent-activity-service.js`
   (in-memory store, TTL sweep, tests), `backend/routes/agent-activity.js`
   (`POST /api/agent-events`, `GET /api/agent-activity`), wire both into
   `backend/server.js` — the new route mount, the `agent-activity:update`
   broadcast path, and the initial-snapshot send on `wss.on('connection')`.
   Verify with a raw `curl -X POST localhost:3001/api/agent-events -d
   '{...SubagentStart shape...}'` before wiring real hooks, so the backend
   half is provably correct independent of the CLI.
4. **End-to-end smoke test**: with steps 1–3 done, actually dispatch a real
   subagent (e.g. ask Joeru to delegate a trivial read-only task to
   `Explore`) with Synapse running, and confirm the events flow start to
   finish through the real hook → real backend path — not just the curl
   simulation.
5. **`senjoeru-synapse` frontend**: `useAgentActivity()` hook; the "Active
   Dispatches" section on `pages/Agents.tsx`; the compact chip + HUD-rail
   card for the Assistant Mode window. Verify with `tsc` + `npm run build`
   clean (this repo's frontend has no test runner — `tsc`/build-clean is the
   established verification bar here, per prior tasks' own handoffs).
6. **Critical negative test — do this before calling it done**: stop the
   Synapse backend entirely, dispatch a real subagent, and confirm there is
   **zero** behavioral difference (no delay, no error surfaced to the user,
   no retry storm) compared to Synapse never having existed. This is the one
   failure mode that would make the feature actively harmful rather than
   merely unfinished, so it gets its own explicit pass rather than being
   assumed from `async: true`.
7. **Docs**: `docs/architecture-review/07-claude-integration.md` currently
   states "No Claude Code hooks are configured for Synapse" and
   `09-api.md`/`10-runtime.md` don't mention this endpoint or WS frame at
   all — these are now wrong and should be corrected in the same pass,
   following the precedent already set in task 18 (stale doc claims fixed
   rather than left to mislead the next reader).
8. *(Optional, sequenced last)* Activity-feed synthesis from
   `SubagentStart`/`SubagentStop`, described in §3.

---

## Risks and trade-offs

- **This is Synapse's first inbound integration point.** Every prior
  Claude-Code-facing feature in this app is a passive file reader; this is
  the first time Claude Code actively calls Synapse. `async: true` makes a
  down backend harmless, but it is a new coupling worth being deliberate
  about rather than treating as "just another collector." Flagged explicitly
  for approval rather than folded in silently.
- **Global scope.** Placing the hook in `~/.claude/settings.json` means every
  Claude Code session on the machine — not just FlowerStorePH work — starts
  firing these events. Traffic stays on `localhost` and the payload is no
  more sensitive than what already lands in `.claude/projects/**/*.jsonl`
  (which Synapse already reads in full), so this isn't a new privacy
  exposure, but it is a broader footprint than a single-repo hook. If Joel
  would rather scope this to specific repos, the alternative is per-project
  `.claude/settings.json` in each monitored repo instead of the global file
  — worth a one-line decision before step 2.
- **Event volume.** `PreToolUse` + `PostToolUse` fire twice per tool call; a
  busy subagent running dozens of calls a minute is real traffic. The
  in-memory store must stay allocation-cheap per event (no disk I/O, no
  verbatim `tool_input` retention) and the WS broadcast is debounced
  (~120ms) specifically to avoid flooding the renderer, while staying far
  faster than the 300ms collector-linked cycle so it still reads as "live."
- **CLI version risk**, covered in §1 — do not build past step 1 without
  confirming the hook events this plan depends on actually fire on the
  installed CLI.
- **Not built:** persistent execution history for dispatched subagents (SQLite
  already has `execution_history` for something adjacent — `analyticsRepo`/
  `db:update`, `server.js:657` — but wiring subagent runs into that is a
  separate, larger decision about whether a dispatch is a business record
  worth permanent storage, and is explicitly out of scope per the task's own
  "not a full history" constraint. Revisit only if Joel asks for it later.)

---

## Testing strategy

- **Backend**: `node --test` unit tests for `agent-activity-service.js`
  (lifecycle, TTL, isolation between parallel `agent_id`s, malformed/partial
  events) and `describe-tool-call.js` (every tool mapping, unknown tool
  fallback, both `file_path`/`filePath` shapes per the existing `describeInput`
  lesson). Manual `curl` verification of the two new routes before wiring
  real hooks.
- **Frontend**: no test runner exists in this repo (confirmed absent in an
  earlier task's handoff) — verify with `npx tsc` and `npm run build` clean,
  matching every prior frontend change here.
- **Integration**: the end-to-end dispatch (step 4) and the backend-down
  negative test (step 6) are the two checks that actually matter for this
  feature and cannot be faked with unit tests alone — both require the real
  Claude Code CLI and are Joel's to run, per this workspace's standing rule
  that nothing here starts servers or drives the live app on someone else's
  behalf.

---

## Durable facts worth filing to joeru-kit memory (not written here — surfaced for Joeru to file, per this workspace's memory-writing convention)

- Claude Code hooks fire for subagent tool calls too, carrying `agent_id` +
  `agent_type` on every event inside a `Task`-tool dispatch — this is the
  mechanism that makes subagent activity observable at all, and it did not
  exist in this project's understanding before this plan (`07-claude-integration.md`
  said flatly "no hooks are configured," which was true but left the
  capability itself undocumented).
- ~~Hook `type: "http"` with `async: true` lets Claude Code push an event to a
  local endpoint with zero risk of blocking or slowing the agent — no script,
  no child process required.~~ **Wrong — see "As built" below.** `http` hooks
  have no `async` option and block by default. Only `type: "command"` hooks
  support `async: true`. This is the fact worth filing, and it is the opposite
  of what this plan assumed.

---

## As built

Implemented 2026-09-14. Two things in the plan above were wrong and are
corrected here rather than quietly diverged from.

1. **`http` hooks cannot be async.** The plan's core safety argument was that
   `type: "http"` + `async: true` would guarantee zero blocking. Checked
   against the Claude Code hooks documentation before building anything on it:
   `http` hooks have **no** `async` option and block by default; only
   `type: "command"` hooks support genuine fire-and-forget. Had this shipped
   as designed, every tool call in every dispatch would have waited on
   Synapse being up.

   The plan listed a forwarder script only as a fallback for an older CLI. It
   is in fact the sole mechanism: `joeru-kit/bin/hook-forward.js`, invoked by
   five `type: "command"` hooks with `async: true`.

2. **`pages/Agents.tsx` does not exist.** The per-agent roster page this plan
   repeatedly cites is `pages/Team.tsx`. "Active Dispatches" was built there.

The step-6 negative test passed: baseline vs. hooks pointed at a confirmed-dead
port, three trials each, no consistent latency difference (~10–14s either way).

Shipped files — Synapse: `shared/describe-tool-call.js` (+test),
`backend/services/agent-activity-service.js` (+test),
`backend/routes/agent-activity.js`, `backend/server.js`,
`frontend/src/lib/{api.ts,useAgentActivity.ts,tool-icons.tsx,agent-display.ts}`,
`frontend/src/pages/{Team.tsx,Assistant.tsx}`,
`frontend/src/components/AssistantStats.tsx`, `frontend/src/index.css`.
joeru-kit: `bin/hook-forward.js`, `bin/joeru-kit.js` (`buildHooks`).

Step 8 (activity-feed synthesis) was left unbuilt, as the plan sequenced it.
