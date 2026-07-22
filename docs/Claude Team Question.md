# SenJoeru Synapse Documentation Generator

I want to document the current state of SenJoeru Synapse before making any architectural changes.

Do NOT redesign or refactor anything.

Only inspect the current implementation and generate documentation.

Create a new folder:

```
docs/architecture-review/
```

Inside that folder, generate the following Markdown files.

---

## 01-overview.md

Include:

* Overall project purpose
* High-level architecture
* Major components
* Current technologies
* Folder structure
* Runtime flow
* How everything works together

---

## 02-project-structure.md

Document:

* Complete folder structure
* Purpose of every major folder
* Important files
* Backend structure
* Frontend structure
* Collectors
* Metrics
* Services
* Utilities

---

## 03-data-storage.md

Document every place where data is stored.

For each JSON file include:

* File path
* Purpose
* Structure
* Example fields
* How often it changes
* Which components read it
* Which components write it

Also include:

* Configuration files
* Runtime files
* Cache files

---

## 04-agents.md

Document every AI agent.

For each agent include:

* Name
* Purpose
* Responsibilities
* Prompt file
* Memory file
* Context sources
* Tools
* Current limitations

---

## 05-task-system.md

Document:

* How tasks are created
* How tasks are updated
* Current task lifecycle
* Current task JSON structure
* Task ownership
* Agent assignment
* Progress tracking

---

## 06-repositories.md

Document:

* All supported repositories
* How repositories are discovered
* Current repository metadata
* Project organization
* Multi-project support

---

## 07-claude-integration.md

Document everything related to Claude.

Include:

* Current Claude setup
* .claude directory
* Agent configuration
* Memory
* Sessions
* Hooks
* Commands
* Prompt files
* Context loading
* Current workflow

Do NOT modify anything.

Only explain how it currently works.

---

## 08-dashboard.md

Document:

* Dashboard architecture
* Pages
* API endpoints
* WebSocket usage
* Polling
* Metrics
* Live updates
* Components
* State management

---

## 09-api.md

Document every backend endpoint.

Include:

* Route
* Method
* Purpose
* Request
* Response

---

## 10-runtime.md

Document runtime behavior.

Include:

* Startup sequence
* Background services
* Collectors
* File watchers
* Scheduler
* WebSockets
* Metrics generation

---

## 11-dependencies.md

Document:

* Frameworks
* Libraries
* External services
* Claude dependencies
* Node packages
* Build tools

---

## 12-known-issues.md

Document:

* Technical debt
* TODOs
* Limitations
* Hardcoded values
* Potential bottlenecks
* Scalability concerns

Do NOT propose solutions.

Just document the current state.

---

## Documentation Rules

* Be objective.
* Do not redesign the architecture.
* Do not suggest improvements.
* Do not write code.
* If information cannot be determined from the codebase, explicitly state that.
* Prefer tables and diagrams where appropriate.
* Include file paths whenever possible.
* Assume these documents will later be reviewed by another software architect.
