# 07 — Claude Integration

> Everything Synapse reads from Claude Code. **Synapse only reads the Claude directory — it never modifies it.** This document describes how it currently works; nothing here proposes changes.

---

## Current Claude setup

- Synapse is built to observe **Claude Code** running on the local workstation.
- The single integration point is the filesystem directory **`C:\Users\joelr\.claude\`**, hardcoded as `CLAUDE_DIR` in both [backend/server.js](../../backend/server.js) and [collectors/index.js](../../collectors/index.js).
- There is **no Claude API usage, no MCP client, no SDK call** inside Synapse. Integration is purely file-based reads. This is the "zero-token monitoring" design.
- The directory path is also surfaced (and editable) in the Settings UI as `claudeDir`, but the code paths that read it are the hardcoded constant — the editable field is stored in `config.json` and shown as "read-only, never modified by Synapse".

---

## The `.claude` directory (observed layout)

Actual top-level contents of `C:\Users\joelr\.claude\` observed on this machine:

```
C:\Users\joelr\.claude\
├── agents/                 # agent definition .md files (READ by collectAgents)
├── sessions/               # <pid>.json active-session files (READ by collectSessions/agents)
├── projects/               # per-project dirs holding *.jsonl transcripts + memory/ (READ by tokens/tasks)
├── tasks.json              # the live task board (READ by collectTasks)
├── tasks.json.bak          # backup (not read by Synapse)
├── CLAUDE.md               # global user instructions (not read by Synapse's collectors)
├── settings.json           # Claude Code global settings (theme/effort/model)
├── history.jsonl
├── plans/  plugins/  ide/  telemetry/  cache/  daemon/  debug/
├── backups/  file-history/  paste-cache/  session-env/  shell-snapshots/
├── policy-limits.json  remote-settings.json  .credentials.json  ...
```

Synapse's `GET /api/claude/info` probes for the subdirectories `agents, sessions, projects, history, cache, debug, daemon` and reports each one's existence/size/mtime.

**What Synapse actually reads:**

| Path | Read by | For |
|---|---|---|
| `.claude/agents/*.md` | `collectAgents()` | agent list + descriptions |
| `.claude/sessions/*.json` | `collectSessions()`, `getActiveAgentNames()`, `detect-repos` | active sessions, Working detection, repo auto-detect |
| `.claude/projects/**/*.jsonl` | `collectTokens()`, `getLatestJSONLMtime()` | token/cost analytics, last-activity mtime |
| `.claude/projects/*/memory/*.md` | `collectTasks()` (fallback only) | memory-derived tasks |
| `.claude/tasks.json` | `collectTasks()` | the live task board |

---

## Agent configuration

- Agents are configured entirely in `.claude/agents/*.md` (YAML frontmatter + system-prompt body). Synapse reads them read-only. See [04-agents.md](04-agents.md).
- Synapse parses only the `name` and `description` frontmatter fields; `tools`/`model` are present in the files but ignored by Synapse.

---

## Memory

- Claude memory lives at `.claude/projects/<project-dir>/memory/*.md` with an index `MEMORY.md`.
- For this project the memory dir holds: `MEMORY.md`, `dont-start-servers.md`, `project-data-architecture.md`, `project-overview.md`, `task-schema.md`.
- Synapse uses memory files **only as a fallback task source** — if `.claude/tasks.json` cannot be read, `collectTasks()` parses each memory `.md` frontmatter into a synthesized task. In normal operation (board present) memory is not consulted.

---

## Sessions

- Session files are `.claude/sessions/<pid>.json`, one per running Claude Code process.
- Example (live): `{ "pid": 11284, "sessionId": "15e8...", "cwd": "d:\\JOELRAYTON WORKS\\senjoeru-synapse", "startedAt": <epoch ms>, "version": "2.1.186", "kind": "interactive", "entrypoint": "claude-vscode" }`.
- Synapse reads `pid`, `sessionId`, `cwd`, `version`, `kind`, `startedAt` for the Sessions display, and uses `cwd` + newest transcript mtime to infer which agents are Working.
- Session files are **deleted when Claude Code exits**; the collector watches for that `unlink` event to clear Working status immediately.

---

## Hooks

- **No Claude Code hooks are configured for Synapse.** `.claude/settings.json` (global) contains only `{ theme, effortLevel, model }`; there is no `hooks` block.
- Synapse's own reactivity comes from `chokidar` **filesystem watchers**, not Claude hooks — see [10-runtime.md](10-runtime.md).

---

## Commands

- **No custom slash commands.** `C:\Users\joelr\.claude\commands\` is empty. Synapse does not define or rely on any Claude commands.

---

## Prompt files

- The only prompt files in play are the agent system prompts in `.claude/agents/*.md`. Synapse does not ship or manage prompt files of its own.
- The FlowerStorePH product repos (`fs-llm-service`, etc.) contain their own prompt files (`system-{ph,th,vn,sg}.ts`), but those live in the monitored repos, not in Synapse.

---

## Context loading

How data flows from Claude's files into Synapse's context each cycle:

1. Collector reads `.claude/sessions/*.json` → open sessions + cwds.
2. For each cwd → find the matching `.claude/projects/<dir>` and the newest `*.jsonl` mtime → Working/idle + last-activity.
3. Collector reads `.claude/agents/*.md` → the agent roster.
4. Collector reads `.claude/tasks.json` → tasks (or memory `.md` fallback).
5. Collector walks `.claude/projects/**/*.jsonl` → token usage (dedup by message id) → cost.
6. Results are written to `metrics/*.json`; the backend serves + broadcasts them.

The **global `CLAUDE.md`** at `C:\Users\joelr\.claude\CLAUDE.md` instructs agents to keep `tasks.json` updated — this is the human/agent-side convention that makes the task mirror work, but Synapse itself does not parse `CLAUDE.md`.

---

## Current workflow (end to end)

```
Developer runs Claude Code (VS Code / terminal)
        │  writes sessions/*.json, projects/**/*.jsonl, updates tasks.json, memory/*.md
        ▼
.claude directory  ──(read-only)──►  Synapse collector  ──►  metrics/*.json
        ▲                                                          │
        │ (agents edit tasks.json per CLAUDE.md rule)              ▼
        └───────────────────────────────────  backend  ──►  dashboard (Electron)
```

---

## Repo-scoped Claude config for Synapse itself

- `senjoeru-synapse/.claude/settings.local.json` is a **permission allowlist** for running Claude Code *inside this repo* (allows specific `node --check` / collector-run / scratchpad-script Bash calls). It configures Claude Code's behavior when developing Synapse — it is not consumed by the Synapse app at runtime.

---

## Current limitations (state, not recommendations)

- **Single hardcoded Claude directory** (`C:\Users\joelr\.claude`) in two files; the editable Settings field does not actually redirect the readers.
- **No API/MCP integration** — purely file-based; if Claude changes its on-disk formats, the collectors must be updated.
- **Working detection depends on transcript mtime**, which is a proxy for "last Claude reply", not a guaranteed liveness signal.
- **`claudeSize`** in `system/health` uses `statSync(dir).size` (the directory entry size), not a recursive size — the reported size is not the true footprint.
