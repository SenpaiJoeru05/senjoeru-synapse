# Setting up SenJoeru Synapse

You are an AI agent working inside a fresh clone of this repository. If the
person asks you to set it up, do what follows. It takes a few minutes and needs
nothing from them beyond answering one question.

Everything here is for **this machine**. Nothing you write in `metrics/config.json`
or `data/` is ever committed — both are gitignored.

## 1. Check the prerequisites

```bash
node --version
```

**Node 22 or newer is required**, not preferred: the OpenCode collector uses the
built-in `node:sqlite`, which landed in 22.5. On an older Node the app runs but
the Joeru Activity tab reports OpenCode as unavailable. Say so plainly rather
than letting them discover it later.

## 2. Install

```bash
npm install
```

This installs the root, `frontend/`, `backend/`, and `collectors/` in one pass.
It takes a few minutes. Do not run the sub-installs by hand.

## 3. Create their config

```bash
cp metrics/config.example.json metrics/config.json
```

Then edit it for them. Every field is optional and defaults sensibly, so only
change what you actually know:

- **`workspace.name`** — what they call their work, not a project name. This is
  the centre of the Agent Network graph. Ask them if it is not obvious.
- **`repositories`** — absolute paths to the repos they work in. Look for git
  repos near this clone and under their home; confirm the list before writing it.
- **`repoAgents`** — which agent owns which repo. Skip it if they have no agents
  yet; repos still appear, just without ownership edges.
- **Leave `projects` out.** Projects are derived from each repo's parent folder,
  which is almost always right. Declare it only if they want different grouping.
- **Leave every `null` alone** unless you know otherwise. Those resolve at
  runtime from their home directory.

## 4. Start it

```bash
npm run dev
```

Five processes: frontend, backend, collectors, `opencode serve`, and Electron.
Use `npm run dev:web` for a browser instead of the desktop window.

**Do not start it yourself unless they ask.** Tell them the command. People
generally want to launch their own long-running processes.

## 5. Tell them what works and what needs more

Most pages read whatever is already on their machine and will be empty until
they have used Claude Code or OpenCode. An empty page is correct, not broken —
say so, or they will think the install failed.

| Page | Needs |
|---|---|
| Overview, Git, History, Insights | Nothing — reads existing sessions and git |
| Tasks | Agents that write the task board (see below) |
| Team | Agent definitions in `~/.claude/agents` |
| Joeru → Chat | `opencode serve` — `npm run dev` starts it |
| Joeru → Memory | A [joeru-kit](https://github.com/SenpaiJoeru05/joeru-kit) checkout |

## The task board

`data/tasks.json` is this app's own format. **Claude Code has no native task
board** — it exists because agents are instructed to write one.

So the Tasks page stays empty until something writes it. Two ways:

- Install **joeru-kit**, whose agents already know the path, or
- Add a line to their `CLAUDE.md` / `AGENTS.md` telling agents to keep
  `<this repo>/data/tasks.json` updated, using the schema in
  `shared/tasks-board.js`.

If they ask why the page is empty, this is the answer. Do not tell them it is
broken.

## Verifying

```bash
cd frontend && npx tsc --noEmit
cd ../backend && node --test services/*.test.js lib/*.test.js
```

Tests are config-independent — they read a fixture, not their config — so a
failure is a real failure, not a setup problem.

## Do not

- **Do not commit `metrics/config.json` or anything under `data/`.** Both hold
  their machine's paths and their private task board.
- **Do not edit files under `~/.claude/agents`, `~/.claude/skills`, or
  `~/.config/opencode/agents`** if they use joeru-kit. Those are generated; the
  next build overwrites anything you put there.
- **Do not invent repository paths.** Confirm each one exists before writing it
  into the config. A wrong path produces an empty dashboard with no error.
