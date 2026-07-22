# 04 — Agents

> How Synapse discovers, models, and tracks AI agents. **Important distinction:** Synapse does not *run* agents. The agents are Claude Code sub-agents defined outside this repo, in `C:\Users\joelr\.claude\agents\*.md`. Synapse only *reads their definition files and activity* to render status.

---

## Where agents come from

- **Definition source:** `C:\Users\joelr\.claude\agents\*.md` (one Markdown file per agent, YAML frontmatter + system prompt body).
- **Discovery:** `collectAgents()` in [collectors/index.js](../../collectors/index.js) reads every `*.md` in that directory, parses frontmatter, and emits one entry per file into `metrics/agents.json`.
- **Naming:** the filename/`name` slug (e.g. `ai-chatbot-engineer`) is converted to a display name by `formatAgentName()` (`"AI Chatbot Engineer"`), keeping the acronyms `ai/db/qa/cs` uppercased.

The 10 agent definition files currently present:
`ai-chatbot-engineer.md`, `backend-engineer.md`, `cs-comms-writer.md`, `db-admin.md`, `devops-engineer.md`, `flow-analyst.md`, `frontend-engineer.md`, `project-manager.md`, `qa-engineer.md`, `security-reviewer.md`.

---

## How "Working" is detected

Synapse infers activity indirectly (it never asks an LLM):

1. `collectSessions()`/`getActiveAgentNames()` read `.claude/sessions/*.json` to find open sessions and their `cwd`.
2. For each session cwd, `getLatestJSONLMtime()` maps the cwd to its Claude project dir (`d:\X\repo` → `d--X-repo`) and finds the newest `*.jsonl` modification time = time of the last Claude reply.
3. If that mtime is within **`ACTIVE_THRESHOLD_MS` = 10 minutes**, the session is "recent".
4. The session's cwd is matched to owning agents via `REPO_PRIMARY_AGENTS` ([shared/agent-repos.js](../../shared/agent-repos.js)). Recent sessions mark those agents **Working** and record `activeCwd`.
5. `lastActivityByAgent` tracks the most recent activity per agent (recent or not) → the "Last update" field.

So an agent's status is a function of *which repo directory has a recently-written conversation log*, not any explicit agent state.

---

## Per-agent documentation

The table below documents each agent from its definition file. **Prompt file** = the `.md` in `.claude/agents/`. Descriptions are quoted/summarized from frontmatter.

| Agent (display) | Prompt file | Purpose (from frontmatter) | Declared tools |
|---|---|---|---|
| AI Chatbot Engineer | `ai-chatbot-engineer.md` | Build/tune the FlowerStorePH chatbot in `fs-llm-service` — prompts, tools, flows, RAG, multi-tenant PH/TH/VN/SG. | Read, Edit, Write, Grep, Glob, Bash |
| Backend Engineer | `backend-engineer.md` | Server-side code — REST/GraphQL APIs, business logic, auth, integrations, data models. | Read, Edit, Write, Grep, Glob, Bash |
| Frontend Engineer | `frontend-engineer.md` | UI — components, layouts, styling, client state, forms, API wiring. | Read, Edit, Write, Grep, Glob, Bash |
| DB Admin | `db-admin.md` | Database layer — schema, migrations, indexes, constraints, query performance. | Read, Edit, Write, Grep, Glob, Bash |
| DevOps Engineer | `devops-engineer.md` | CI/CD, containerization, IaC, deploys, env config, observability. | Read, Edit, Write, Grep, Glob, Bash |
| QA Engineer | `qa-engineer.md` | Writes/runs tests, hunts edge cases, verifies behavior. | Read, Grep, Glob, Bash (review-oriented) |
| Security Reviewer | `security-reviewer.md` | Audits for vulnerabilities (OWASP Top 10); review-only. | Read, Grep, Glob, Bash |
| Project Manager | `project-manager.md` | Breaks features into tasks, assigns specialists, sequences work. | Read, Grep, Glob, Bash, TodoWrite |
| CS Comms Writer | `cs-comms-writer.md` | Plain-language team comms — QA guides, Slack/Telegram updates. | Read, Grep, Glob, Write |
| Flow Analyst | `flow-analyst.md` | Turns flow diagrams + requirements into build-ready specs; read-only analysis. | Read, Grep, Glob, Bash |

> **Note:** The exact `tools:` line varies per file. The values above reflect the frontmatter of `ai-chatbot-engineer.md` (verified: `Read, Edit, Write, Grep, Glob, Bash`, `model: opus`) and the agent registry surfaced to this session; the precise tool list for each other agent should be confirmed by reading its individual `.md` if authoritative accuracy is required. The frontmatter fields Synapse actually parses are only `name` and `description`.

### Example definition (ai-chatbot-engineer.md frontmatter)

```yaml
---
name: ai-chatbot-engineer
description: Builds and tunes the FlowerStorePH AI customer-service chatbot in fs-llm-service — ...
tools: Read, Edit, Write, Grep, Glob, Bash
model: opus
---
```
The body is a full system prompt (live-architecture notes, hard rules like "fsweb is READ-ONLY", multi-tenant parity requirements, etc.).

---

## Per-agent fields (as Synapse models them)

For each agent, the entry Synapse *stores* (in `agents.json`) and *renders* is:

| Field | Source | Notes |
|---|---|---|
| **Name** | `formatAgentName(frontmatter.name or filename)` | e.g. "AI Chatbot Engineer" |
| **Purpose / current task** | `frontmatter.description` (truncated to ~100 chars) | Shown as "currentTask" — it is the *role description*, not a live task. |
| **Responsibilities** | full `.md` body (not stored by Synapse) | Lives only in the `.md`; Synapse does not ingest the body. |
| **Prompt file** | `.claude/agents/<slug>.md` | External to this repo. |
| **Memory file** | `.claude/projects/<project>/memory/*.md` | Per-project, not per-agent (see below). |
| **Context sources** | session cwd + repo↔agent map | Determines Working status + `activeCwd`. |
| **Tools** | `frontmatter.tools` | Declared in the `.md`; Synapse does not use this field. |
| **Assigned project** | `inferProject(description)` | "FlowerStorePH" if the description mentions it, else "General". |
| **Status** | derived (see above) | Working / Idle only. |

---

## Memory files

- **Location:** `C:\Users\joelr\.claude\projects\<project-dir>\memory\*.md`.
- **For this repo:** `d--JOELRAYTON-WORKS-senjoeru-synapse/memory/` currently holds `MEMORY.md` (index) plus `dont-start-servers.md`, `project-data-architecture.md`, `project-overview.md`, `task-schema.md`.
- **Not per-agent:** memory is scoped per *project*, not per agent. Synapse's `collectTasks()` fallback parses these `.md` frontmatter (`name`, `description`) to *derive* tasks only when `.claude/tasks.json` is missing/unreadable.

---

## Repo ↔ agent mapping (drives the graph + Working attribution)

From [shared/agent-repos.js](../../shared/agent-repos.js):

```js
REPO_PRIMARY_AGENTS = {
  'fs-llm-service': ['AI Chatbot Engineer'],
  'chat-widget':    ['AI Chatbot Engineer', 'Frontend Engineer'],
  'cs-dashboard':   ['Frontend Engineer'],
  'fsweb':          ['Backend Engineer'],
  'seller-page':    ['Backend Engineer'],
  'flowerstoreph':  ['AI Chatbot Engineer', 'Backend Engineer'],  // project-root fallback, NOT a repo
}
```
`flowerstoreph` is excluded from real repo nodes (`NON_REPO_KEYS`). Only these five repos + the agents that own them appear in the graph. See [06-repositories.md](06-repositories.md).

---

## Current limitations (state, not recommendations)

- **Status is binary** (Working/Idle). There is no Reviewing/Testing/Error state produced by the collector, even though the UI defines colors for them.
- **`progress` and `runtime` are always `0`** — never computed for agents.
- **`currentTask` is the role description**, truncated — not the agent's actual in-flight task. Real tasks are attached separately via `tasks.json` → `assignedAgent`.
- **Working detection is repo-directory based.** Two agents that own the same repo (e.g. AI Chatbot Engineer + Frontend Engineer both own `chat-widget`) will *both* light up when that repo is active; the collector cannot tell which agent is actually running.
- **10-minute activity window is hardcoded** (`ACTIVE_THRESHOLD_MS`).
- **Agent list is only as accurate as `.claude/agents/`** — if a definition file is missing, the agent simply doesn't appear.
- **The agent's declared `tools`/`model` frontmatter is ignored** by Synapse (only `name`/`description` are parsed).
