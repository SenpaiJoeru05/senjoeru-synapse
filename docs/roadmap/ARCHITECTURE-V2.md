# SenJoeru Synapse v2
## Architecture Vision & Engineering Principles

Version: 2.0 (Draft)

Status: Planning

Author:
SenJoeru Synapse Architecture Team

---

# Vision

SenJoeru Synapse is not a chatbot.

SenJoeru Synapse is not another AI dashboard.

SenJoeru Synapse is a local-first Mission Control operating system for AI Software Engineering teams.

Its purpose is to orchestrate AI agents, monitor engineering activity, manage software projects, and coordinate multiple development workflows while using external coding engines (Claude Code today, potentially other models in the future).

Claude Code is an execution engine.

SenJoeru Synapse is the intelligence and orchestration layer.

---

# Core Philosophy

The system is built around one fundamental principle.

> AI models write code.
> SenJoeru Synapse manages software engineering.

Everything in the platform should reinforce this separation.

The platform should never duplicate features already solved by Claude Code.

Instead it should provide everything Claude Code does not:

• project management

• engineering orchestration

• task management

• repository management

• monitoring

• execution history

• analytics

• metrics

• scheduling

• agent coordination

• operational visibility

---

# Long-Term Goals

SenJoeru Synapse should eventually become capable of managing:

- unlimited projects
- unlimited repositories
- dozens of AI agents
- multiple local workspaces
- multiple coding models
- local LLMs
- cloud LLMs
- engineering analytics
- autonomous engineering workflows

without requiring architectural redesign.

Scalability is a first-class design requirement.

---

# Design Principles

Every future feature should follow these principles.

## 1. Local First

Everything possible should execute locally.

User data remains on the user's machine.

Network connectivity should only be required when an AI provider is needed.

---

## 2. AI Provider Agnostic

Claude Code is currently the preferred execution engine.

However the architecture must never depend on Claude-specific implementations.

Future providers may include:

- OpenAI
- Gemini
- Qwen
- DeepSeek
- Local Ollama models

Changing providers should not require rewriting the platform.

Only the execution adapter should change.

---

## 3. Zero Token Monitoring

Monitoring should never require LLM calls.

Monitoring is powered entirely through:

- collectors
- filesystem events
- git
- metrics
- websocket events
- local databases

This keeps monitoring free and instantaneous.

---

## 4. Event Driven

Polling should be avoided whenever possible.

Preferred order:

Filesystem Event

↓

Collector

↓

Database Update

↓

WebSocket

↓

Frontend

Instead of

Frontend

↓

Polling

↓

Backend

↓

Filesystem

---

## 5. Source of Truth

Every piece of information must have one owner.

Never duplicate ownership.

---

Example

Claude Sessions

Owner:
Claude

Never edited by Synapse.

---------------------

Tasks

Authoring Input:
Claude — via `.claude/tasks.json` (agents write here; Synapse only reads it)

Permanent Owner:
Synapse Database (SQLite)

The flow is one-directional and therefore NOT dual ownership:
Claude writes `tasks.json` → Synapse imports it into SQLite → SQLite is the
permanent source of truth. Synapse never writes `tasks.json`, and only the
sync service writes the SQLite tasks table. Tasks are never owned by metrics JSON.

---------------------

Metrics

Owner:
Collectors

Disposable.

---------------------

UI State

Owner:
Frontend

Temporary.

---

# Ownership Model

The system consists of four ownership layers.

```

Claude Runtime

↓

Collector Layer

↓

Synapse Core

↓

Presentation Layer

```

Each layer has different responsibilities.

---

# Layer 1
## Claude Runtime

Purpose

Runs AI agents.

Responsible for

- sessions
- prompts
- memories
- execution
- transcripts

Location

```

C:\Users\<user>\.claude

```

Important Rule

SenJoeru Synapse should NEVER directly modify Claude runtime files unless explicitly supported by Claude.

These files belong to Claude.

---

# Layer 2
## Collector Layer

Purpose

Observe Claude.

Never control Claude.

Responsibilities

- watch filesystem

- parse runtime

- detect changes

- aggregate metrics

- build activity events

Collectors should remain stateless.

If restarted they rebuild everything.

---

# Layer 3
## Synapse Core

This is the heart of the application.

Responsibilities

- project management

- repository management

- task management

- agent orchestration

- scheduling

- analytics

- execution history

- workspace management

- synchronization

- AI context management

This layer owns the application's business logic.

---

# Layer 4
## Presentation Layer

Responsibilities

Electron

Backend API

WebSocket

React

Mission Control UI

Dashboards

Terminal

Chat

Visualization

Presentation should never contain business logic.

---

# High-Level Architecture

```

                 SenJoeru Synapse

+------------------------------------------------------+

Mission Control UI

|

+------------------------------------------------------+

|

WebSocket

REST API

|

+------------------------------------------------------+

|

Application Core

|

+------------------------------------------------------+

|

SQLite

Synchronization

Collectors

|

+------------------------------------------------------+

|

Claude Runtime

Git

Filesystem

Repositories

|

+------------------------------------------------------+

```

---

# Current Strengths

The current architecture already provides:

✓ Local-first execution

✓ Event-driven monitoring

✓ Collector architecture

✓ WebSocket updates

✓ Repository awareness

✓ Agent awareness

✓ Metrics generation

✓ Dashboard visualization

These should remain architectural strengths.

---

# Current Weaknesses

Several responsibilities are currently mixed together.

Examples include:

- JSON files acting as databases

- runtime state mixed with application state

- duplicated representations of task information

- limited historical persistence

- limited relationship querying

Future versions should separate runtime cache from persistent application data.

---

# Synapse Responsibilities

Synapse should own:

Projects

Repositories

Tasks

Schedules

Execution History

Analytics

Bookmarks

Notes

Settings

Agent Assignments

Workspaces

Queue

Timeline

Token History

Cost History

Mission Control

NOT

Claude Sessions

Claude Memory

Claude Prompts

Claude Runtime

Claude Internal Files

---

# What Synapse Is NOT

SenJoeru Synapse is not:

❌ another IDE

❌ another code editor

❌ another Claude replacement

❌ another VSCode

❌ another terminal emulator

Instead it coordinates existing tools.

---

# Engineering Philosophy

Every engineering decision should answer:

Does this belong to Claude?

or

Does this belong to Synapse?

If the answer is Claude,

do not duplicate it.

If the answer is Synapse,

own it completely.

This philosophy prevents architectural overlap and simplifies long-term maintenance.

---

# Future Vision

The long-term architecture should evolve toward an AI Engineering Operating System.

Instead of simply monitoring AI developers,

Synapse should eventually coordinate them.

Example workflow

User

↓

Mission Control

↓

Project Manager

↓

Task Queue

↓

Backend Agent

↓

Frontend Agent

↓

QA Agent

↓

Claude Code

↓

Repository

↓

Metrics

↓

Analytics

↓

Dashboard

The user should interact with projects rather than directly managing every AI interaction.

---

# Architecture Success Criteria

The architecture is considered successful when:

✓ Supports multiple projects

✓ Supports multiple repositories

✓ Supports many AI agents

✓ Supports multiple LLM providers

✓ Zero-token monitoring

✓ SQLite as Synapse source of truth

✓ Event-driven updates

✓ Clear ownership boundaries

✓ No duplicated responsibilities

✓ Minimal Claude token usage

✓ Extensible plugin architecture

✓ Production-ready code organization

---

# 5. Current Architecture Analysis

This section documents the current architecture of SenJoeru Synapse based on the existing implementation.

The objective is to identify architectural strengths that should be preserved and implementation details that should evolve over time.

This analysis is descriptive rather than prescriptive.

It documents the current system before future migration work begins.

---

## Existing Architecture Overview

The current implementation is composed of four primary runtime processes.

```

Electron

↓

Frontend (React + Vite)

↓

Backend (Express + WebSocket)

↓

Collectors

↓

Claude Runtime (.claude)

↓

Repositories

```

Electron is responsible for application lifecycle management.

The frontend provides the Mission Control user interface.

The backend exposes REST APIs and WebSocket endpoints.

Collectors continuously observe Claude runtime files and local repositories to generate metrics.

Claude Code remains responsible for AI execution.

Repositories remain the source code being developed.

---

## Existing Architectural Strengths

The current implementation already demonstrates several production-quality architectural decisions.

These strengths should be preserved throughout future versions.

### Local First

The platform operates entirely on the local machine.

No cloud infrastructure is required for monitoring.

All repositories remain local.

All metrics are generated locally.

This enables:

- low latency
- offline operation
- privacy
- minimal infrastructure cost

---

### Collector-Based Architecture

Instead of embedding monitoring logic inside the backend,

the application separates monitoring into independent collectors.

Current collectors include:

- Agent Collector
- Token Collector
- Session Collector
- Git Collector
- Task Collector
- Activity Collector

This separation makes the monitoring pipeline modular and maintainable.

Additional collectors can be introduced without affecting the frontend.

---

### Event-Driven Updates

The application already favors filesystem events combined with WebSocket broadcasts.

Collectors observe runtime changes.

The backend broadcasts only when payloads change.

The frontend reacts to events instead of performing unnecessary polling.

This significantly reduces CPU usage and unnecessary network traffic.

This architecture should remain the preferred model.

---

### Repository Awareness

Unlike a traditional AI chat interface,

SenJoeru Synapse already understands repositories.

It can associate:

- repositories
- branches
- git activity
- commits
- tasks
- agents

This repository-centric design should continue to evolve.

---

### Agent Awareness

The platform already models software engineering through specialized AI agents.

Examples include:

- Backend Developer
- Frontend Developer
- QA Engineer
- Chatbot Engineer

Rather than acting as a single assistant,

the platform is designed around specialized responsibilities.

This is considered one of the defining characteristics of SenJoeru Synapse.

---

### Zero-Token Monitoring

Monitoring currently relies on:

- filesystem observation
- git inspection
- runtime parsing
- local metrics generation

No LLM calls are required for monitoring.

This architectural decision minimizes operational cost while maintaining real-time visibility.

This principle should never be abandoned.

---

## Existing Architectural Limitations

The following limitations have been identified.

These are natural consequences of the current implementation and should not be considered failures.

They represent opportunities for architectural evolution.

---

### JSON as Persistent Storage

Several application concepts are currently represented through JSON files.

Examples include:

- metrics
- tasks
- activity
- agents

JSON is well suited for runtime cache.

It is less suitable as a long-term application database.

Current limitations include:

- no relational querying

- duplicated representations

- limited historical tracking

- difficult synchronization

- increasing complexity as data grows

Future versions should introduce a dedicated application database while retaining JSON where appropriate.

---

### Mixed Ownership

Some information currently exists in multiple representations.

For example:

Claude Runtime

↓

Collector

↓

Metrics JSON

↓

Frontend

As the application grows,

clear ownership boundaries become increasingly important.

Every entity should have one authoritative owner.

---

### Limited Historical Persistence

Current metrics primarily represent the present state of the system.

Long-term analytics remain limited.

Examples include:

- token history

- execution history

- repository evolution

- engineering velocity

Future versions should prioritize historical analytics.

---

### Scaling Beyond Multiple Projects

The current implementation was originally optimized around a small number of repositories.

Future versions should support:

- multiple organizations

- multiple workspaces

- multiple projects

- many repositories

without architectural modification.

---

### Runtime Coupling

The dashboard currently relies heavily on runtime-generated JSON files.

While this provides excellent responsiveness,

it also couples visualization with runtime cache.

Future versions should separate:

persistent business data

from

runtime-generated metrics.

---

## Architectural Opportunities

The current implementation provides an excellent foundation for future expansion.

Future improvements should focus on:

- persistent storage

- orchestration

- execution history

- project management

- scheduling

- analytics

- workspace management

without replacing the successful collector architecture.

---

## Architecture Decisions

The following decisions are established by this document.

AD-001

The Collector architecture will remain a permanent subsystem.

It will not be replaced by direct frontend polling.

---

AD-002

Zero-token monitoring remains a permanent design requirement.

Monitoring must never depend on LLM requests.

---

AD-003

Collectors are observers.

Collectors are not orchestrators.

Business logic belongs elsewhere.

---

AD-004

Claude Runtime remains external to Synapse.

Synapse observes Claude.

It does not replace Claude.

---

AD-005

Runtime cache is disposable.

Application data is persistent.

These concepts must remain separated.

---

# 6. System Layers

SenJoeru Synapse is organized into independent architectural layers.

Each layer has a clearly defined responsibility.

A layer must never assume responsibilities belonging to another layer.

This separation minimizes coupling and allows each subsystem to evolve independently.

---

## Layer 1 — User Interface Layer

Purpose

Provide visualization and user interaction.

Responsibilities

- Mission Control Dashboard

- Chat Interface

- Terminal Workspace

- Repository Explorer

- Project Views

- Task Board

- Agent Visualization

- Analytics

The User Interface should never implement business logic.

Its only responsibility is presentation.

---

## Layer 2 — API Layer

Purpose

Provide communication between the interface and application core.

Responsibilities

- REST API

- WebSocket

- Authentication (future)

- Request Validation

- Event Broadcasting

The API Layer should remain stateless whenever possible.

It should delegate all business decisions to the Application Layer.

---

## Layer 3 — Application Layer

This is the heart of SenJoeru Synapse.

Responsibilities include:

- Project Management

- Repository Management

- Task Management

- Agent Management

- Scheduling

- Queue Management

- Synchronization

- Execution History

- Analytics

- Context Management

The majority of future development will occur within this layer.

---

## Layer 4 — Data Layer

Purpose

Provide persistent application storage.

Future versions will primarily use SQLite.

This layer owns:

- Projects

- Tasks

- Repositories

- Agent Metadata

- Activity History

- Execution History

- Token History

- Cost History

- User Settings

- Workspace Settings

The Data Layer is the source of truth for application-owned information.

---

## Layer 5 — Runtime Layer

Purpose

Observe external runtime systems.

Current responsibilities include:

- Collector Engine

- Git Inspection

- Filesystem Monitoring

- Metrics Generation

- Runtime Parsing

This layer continuously translates runtime activity into structured information.

Runtime data should never become the application's permanent database.

---

## Layer 6 — External Execution Layer

This layer contains external systems that execute work.

Examples include:

- Claude Code

- Git

- Local Repositories

- Future AI Providers

- Local LLMs

- Cloud LLM APIs

SenJoeru Synapse coordinates these systems.

It does not replace them.

---

## Layer Communication Rules

Communication must always flow through adjacent layers.

Example

```

User Interface

↓

API

↓

Application

↓

Data

↓

Runtime

↓

External Systems

```

Skipping layers should be avoided.

This keeps responsibilities clear and minimizes architectural coupling.

---

## Layer Independence

Each layer should be independently testable.

Replacing one layer should have minimal impact on the others.

Example:

Replacing Claude Code with another execution provider should not require modifications to:

- Mission Control UI

- Project Management

- Task Management

- Analytics

Only the External Execution Layer should change.

---

## Architecture Decisions

AD-006

The Application Layer owns business logic.

Business logic must never exist in the frontend.

---

AD-007

The Data Layer owns persistence.

JSON files are not the long-term application database.

---

AD-008

Runtime layers are observational.

They never own business entities.

---

AD-009

External AI providers are replaceable.

The architecture must remain provider-agnostic.

---

AD-010

Every architectural layer should have a single responsibility.

No layer should duplicate another layer's purpose.

---
# 7. Data Ownership Matrix

One of the primary architectural goals of SenJoeru Synapse is to eliminate ambiguity regarding data ownership.

Every piece of information within the platform must have exactly one authoritative owner.

This owner is responsible for creating, updating, validating, and maintaining the lifecycle of that data.

Other components may observe, cache, or display the data, but they must never become the source of truth.

This principle prevents duplicated state, synchronization issues, conflicting updates, and long-term maintenance complexity.

---

# Ownership Principles

The following rules apply throughout the system.

## Rule 1

Every entity has one owner.

Never allow multiple systems to own the same information.

---

## Rule 2

Derived data should never become authoritative.

If information can be regenerated from another source,

it is considered derived data.

Derived data is disposable.

---

## Rule 3

Runtime state and business data are different concepts.

Runtime state describes what is happening now.

Business data describes information the application owns permanently.

These must never be mixed.

---

## Rule 4

Caches may be deleted at any time.

Deleting cache should never cause permanent data loss.

If deleting a file would lose important information,

that file is not a cache.

---

## Rule 5

Only the owning subsystem may write authoritative data.

All other layers should treat that data as read-only.

---

# Ownership Categories

SenJoeru Synapse divides ownership into four categories.

## 1. External Ownership

Data managed entirely by external systems.

Examples:

- Claude Runtime
- Git
- Local Repositories
- External LLM Providers

Synapse observes this information.

It does not own it.

---

## 2. Persistent Ownership

Application data owned by Synapse.

Stored inside SQLite.

Examples:

- Projects
- Tasks
- Repository Metadata
- Agent Profiles
- Workspace Settings
- Execution History
- Analytics
- Notes
- Bookmarks

This data cannot be regenerated from runtime.

SQLite becomes the permanent source of truth.

---

## 3. Runtime Ownership

Temporary information generated while the application is running.

Examples:

- Metrics
- Current Agent Status
- Active Sessions
- Current Repository State
- Live Dashboard Data

Runtime data may disappear after restart.

Collectors regenerate this information automatically.

---

## 4. Presentation Ownership

Temporary frontend state.

Examples:

- Selected Project
- Open Tabs
- UI Filters
- Window Layout
- Expanded Panels

Presentation state exists only for user interaction.

It should never become application data.

---

# Ownership Matrix

| Entity | Owner | Storage | Persistent | Regeneratable |
|----------|-------|----------|------------|---------------|
| Claude Sessions | Claude Runtime | `.claude` | Yes | No |
| Claude Memory | Claude Runtime | `.claude` | Yes | No |
| Claude Prompts | Claude Runtime | `.claude` | Yes | No |
| Agent Definitions | Claude Runtime | `.claude/agents` | Yes | No |
| Task Board Input | Claude Runtime | `.claude/tasks.json` | Yes | No |
| Git History | Git | Repository | Yes | Yes |
| Repository Files | Repository | Filesystem | Yes | No |
| Metrics | Collector Engine | JSON Cache | No | Yes |
| Active Agent Status | Collector Engine | JSON Cache | No | Yes |
| Active Sessions | Collector Engine | JSON Cache | No | Yes |
| Live Dashboard Data | Collector Engine | JSON Cache | No | Yes |
| Projects | Synapse | SQLite | Yes | No |
| Tasks (permanent record) | Synapse | SQLite | Yes | No (imported from `.claude/tasks.json`) |
| Repository Metadata | Synapse | SQLite | Yes | No |
| Execution History | Synapse | SQLite | Yes | No |
| Token History | Synapse | SQLite | Yes | No |
| Cost History | Synapse | SQLite | Yes | No |
| Notes | Synapse | SQLite | Yes | No |
| Bookmarks | Synapse | SQLite | Yes | No |
| User Settings | Synapse | SQLite | Yes | No |
| Workspace Settings | Synapse | SQLite | Yes | No |
| UI Filters | Frontend | Browser Memory | No | Yes |
| Expanded Panels | Frontend | Browser Memory | No | Yes |
| Selected Repository | Frontend | Browser Memory | No | Yes |

---

# Write Permissions

The following matrix defines which subsystem may modify each ownership category.

| Subsystem | Claude Runtime | SQLite | Metrics | UI State |
|------------|---------------|---------|----------|----------|
| Frontend | ❌ | ❌ | ❌ | ✅ |
| Backend API | ❌ | ✅ | ❌ | ❌ |
| Application Services | ❌ | ✅ | ❌ | ❌ |
| Collector Engine | Read Only | ❌ | ✅ | ❌ |
| Claude Runtime | ✅ | ❌ | ❌ | ❌ |

Any architecture violating these permissions should be considered incorrect.

---

# Data Flow

The expected direction of information is always:

```

External Systems

↓

Collectors

↓

Application Core

↓

SQLite

↓

API

↓

Frontend

```

Information should never move in the opposite direction unless explicitly supported by the owning subsystem.

For example,

the frontend should never directly modify Collector data.

Similarly,

Collectors should never directly modify SQLite business entities.

---

# Cache Strategy

The application distinguishes between permanent data and cache.

Permanent Data

- SQLite
- Repository Files
- Claude Runtime

Cache

- metrics/*.json
- websocket payloads
- frontend state
- computed statistics

Cache may be rebuilt at any time.

Permanent data may not.

---

# Synchronization Strategy

Synchronization should always occur from the authoritative owner.

Example:

```

Claude Runtime

↓

Collector

↓

Runtime Metrics

↓

Application Services

↓

SQLite (if required)

↓

Frontend

```

The reverse flow should not occur.

SQLite should never overwrite Claude runtime files.

Similarly,

runtime metrics should never overwrite application-owned records.

---

# Ownership Violations

The following are considered architectural violations.

❌ SQLite modifying Claude sessions.

❌ Frontend writing directly into metrics.

❌ Collectors modifying Projects.

❌ Runtime cache replacing persistent storage.

❌ Multiple databases storing the same business entity.

❌ Two independent sources of truth for Tasks.

❌ Frontend becoming responsible for business rules.

These patterns increase maintenance complexity and create synchronization problems.

## Sanctioned exception: Tasks (`.claude/tasks.json` → SQLite)

The one-directional task flow is explicitly NOT a "two sources of truth"
violation, because only one subsystem writes at each stage:

```
Claude (agents)  →  .claude/tasks.json  →  Sync Service  →  SQLite  →  UI
   writes only          read-only to           writes           read-only
                        Synapse                SQLite only       downstream
```

- `.claude/tasks.json` is Claude's **authoring inbox** — an external input,
  owned by Claude, treated read-only by Synapse (same category as sessions).
- The SQLite `tasks` table is Synapse's **permanent record** — the only
  writable authority for application task data, written solely by the sync
  service.
- Synapse must NEVER write `.claude/tasks.json`, and nothing but the sync
  service may write the SQLite `tasks` table. This keeps the flow one-way and
  compliant with AD-011.

---

# Future Expansion

The ownership model intentionally supports future execution providers.

Examples include:

- Claude Code
- OpenAI Codex
- Gemini CLI
- Qwen Code
- Local Ollama Agents

Regardless of execution provider,

ownership rules remain identical.

Only the execution adapter changes.

The rest of the architecture remains unchanged.

---

# Architecture Decisions

AD-011

Every business entity must have exactly one authoritative owner.

---

AD-012

SQLite is the permanent source of truth for all Synapse-owned data.

---

AD-013

Collectors own runtime metrics but never business entities.

---

AD-014

Caches are disposable.

Persistent data is not.

---

AD-015

External execution engines remain independent from Synapse.

Synapse coordinates them.

It does not replace them.

---
# 8. Runtime Flow

This section defines how SenJoeru Synapse behaves while the application is running.

Unlike the previous sections, which describe ownership and responsibilities, this section focuses on the movement of information throughout the system.

The runtime architecture is designed around observation rather than control.

Claude Code performs software engineering work.

SenJoeru Synapse continuously observes, processes, stores, and visualizes that work.

---

# Runtime Philosophy

The runtime architecture follows one simple principle.

> Observe everything.
> Own only what belongs to Synapse.

This philosophy minimizes coupling between Synapse and external execution engines.

The application should continue functioning even if execution providers change in the future.

---

# Runtime Components

The runtime consists of six major components.

```

User

↓

Mission Control UI

↓

Backend API

↓

Application Services

↓

Collector Engine

↓

External Runtime

```

Each component has an independent responsibility.

---

# Runtime Lifecycle

When the application starts, the following sequence occurs.

```

Electron Launches

↓

Backend Starts

↓

SQLite Opens

↓

Collector Engine Starts

↓

Filesystem Watchers Register

↓

Git Watchers Register

↓

WebSocket Server Starts

↓

Frontend Connects

↓

Initial State Loaded

↓

Mission Control Ready

```

No AI providers are required during startup.

Startup should complete entirely using local resources.

---

# Collector Runtime

Collectors continuously observe external systems.

Typical collector responsibilities include:

- Watch Claude runtime

- Watch repositories

- Monitor Git

- Parse sessions

- Read task files

- Compute metrics

Collectors should never modify runtime files.

They are observers only.

---

# Event Processing Pipeline

Every runtime event follows the same processing pipeline.

```

External Event

↓

Collector

↓

Parser

↓

Normalizer

↓

Application Service

↓

SQLite (if applicable)

↓

WebSocket

↓

Frontend

```

Every stage has a single responsibility.

---

# Example Runtime Event

A Backend Agent begins editing a repository.

The runtime sequence becomes:

```

Claude Code

↓

Session Updated

↓

Filesystem Event

↓

Collector Detects Change

↓

Session Parser

↓

Repository Resolver

↓

Agent Resolver

↓

Metrics Updated

↓

SQLite Updated (if required)

↓

WebSocket Broadcast

↓

Mission Control Refreshes

```

No polling is required.

---

# Runtime Responsibilities

## Frontend

Responsible for:

- rendering UI

- subscribing to WebSocket

- calling APIs

- displaying state

Never responsible for:

- business logic

- repository parsing

- metrics generation

---

## Backend

Responsible for:

- routing

- validation

- event distribution

- service coordination

- API responses

Backend components should remain lightweight.

Business logic belongs in services.

---

## Application Services

Responsible for:

- project logic

- repository logic

- synchronization

- scheduling

- analytics

- orchestration

This layer becomes the operational brain of Synapse.

---

## Collector Engine

Responsible for:

- runtime observation

- filesystem watching

- git parsing

- metrics generation

- activity generation

Collectors should never own business rules.

---

## SQLite

Responsible for persistent storage.

SQLite stores:

- projects

- tasks

- repositories

- execution history

- analytics

- settings

SQLite should never become a runtime cache.

---

# Runtime Isolation

Every runtime component should be restartable independently.

Examples

Restarting:

Frontend

should not restart collectors.

Restarting:

Collectors

should not restart Electron.

Restarting:

Backend

should not lose SQLite data.

This isolation improves reliability and simplifies debugging.

---

# Runtime Recovery

If a runtime component fails,

the system should recover automatically whenever possible.

Examples:

Collector crashes

↓

Restart Collector

↓

Rebuild Metrics

↓

Continue Monitoring

Database reconnects

↓

Reload Services

↓

Resume API

Frontend refresh

↓

Reconnect WebSocket

↓

Reload Current State

↓

Continue Session

The architecture should favor graceful recovery over complete application restarts.

---

# Runtime Performance Goals

The runtime architecture should target the following objectives.

Application Startup

< 5 seconds

---

Collector Processing

< 100 milliseconds

---

WebSocket Broadcast

< 50 milliseconds

---

Frontend Update

< 16 milliseconds

---

Dashboard Refresh

Near Real-Time

---

Token Cost

Zero

---

These targets represent engineering goals rather than strict requirements.

---

# Runtime Failure Principles

Runtime failures should remain isolated.

A failure in one subsystem must not cascade into others.

Examples:

Git failure

Should not stop dashboard updates.

Claude unavailable

Should not stop project management.

Collector restart

Should not close Mission Control.

Frontend refresh

Should not interrupt collectors.

The platform should degrade gracefully.

---

# Runtime State Categories

Runtime information is divided into three categories.

## Active State

Current sessions

Current agent activity

Current repositories

Live metrics

---

## Persistent State

Projects

Tasks

Execution history

Settings

Analytics

---

## Ephemeral State

WebSocket payloads

Temporary caches

Computed statistics

Frontend state

Ephemeral state should always be rebuildable.

---

# Architecture Decisions

AD-016

Runtime components communicate through well-defined interfaces.

---

AD-017

Collectors observe but never orchestrate.

---

AD-018

Runtime failures should remain isolated.

---

AD-019

Application startup should not require AI providers.

---

AD-020

Every runtime event should flow through a deterministic processing pipeline.

---
# 9. Event Flow

The Event Flow architecture defines how information moves throughout SenJoeru Synapse in response to runtime activity.

Every significant action within the platform should be represented as an event.

Instead of components continuously requesting updates from one another, components react to published events.

This architecture reduces coupling, improves scalability, minimizes unnecessary processing, and simplifies future expansion.

---

# Event Philosophy

The event system follows four fundamental principles.

## Principle 1

Everything important is an event.

Examples include:

- Agent starts working
- Agent becomes idle
- Repository changes
- Git commit created
- Task completed
- Queue updated
- SQLite record created
- Settings modified
- Terminal output received
- AI response completed

---

## Principle 2

Events are immutable.

Once published,

an event should never be modified.

If information changes,

a new event should be emitted.

---

## Principle 3

Events describe what happened,

not what should happen.

Good

AgentStarted

Bad

StartAgent

Events represent facts.

Commands represent intentions.

The architecture distinguishes between the two.

---

## Principle 4

Components subscribe only to events they require.

No component should process unnecessary information.

---

# Event Lifecycle

Every event follows the same lifecycle.

```

Event Source

↓

Event Created

↓

Validation

↓

Event Bus

↓

Subscribers

↓

Processing

↓

Persistence (if required)

↓

WebSocket Broadcast

↓

Frontend Update

```

Each stage performs one responsibility only.

---

# Event Sources

Events may originate from several different subsystems.

## Claude Runtime

Examples

- Session updated
- Prompt completed
- Agent switched repositories

---

## Collector Engine

Examples

- Repository changed
- Token usage recalculated
- Metrics regenerated
- Activity detected

---

## Git

Examples

- Commit created
- Branch changed
- Merge completed
- Repository opened

---

## SQLite

Examples

- Project created
- Task updated
- Schedule modified
- Settings changed

---

## User Interface

Examples

- Project selected
- Task created
- Queue reordered
- Repository pinned

---

# Event Categories

Events are grouped according to their purpose.

## Runtime Events

Prefix

```
RT-
```

Examples

```
RT-AgentStarted
RT-AgentStopped
RT-SessionUpdated
RT-RepositoryChanged
```

---

## Project Events

Prefix

```
PR-
```

Examples

```
PR-ProjectCreated
PR-ProjectArchived
PR-RepositoryAdded
```

---

## Task Events

Prefix

```
TS-
```

Examples

```
TS-TaskCreated
TS-TaskAssigned
TS-TaskCompleted
```

---

## Analytics Events

Prefix

```
AN-
```

Examples

```
AN-TokenRecorded
AN-CostUpdated
AN-VelocityCalculated
```

---

## System Events

Prefix

```
SY-
```

Examples

```
SY-Startup
SY-Shutdown
SY-CollectorRestarted
SY-WebSocketConnected
```

---

# Event Processing Pipeline

Every event should follow the same processing pipeline.

```

Event Source

↓

Collector or Service

↓

Validation

↓

Normalization

↓

Event Bus

↓

Subscribers

↓

SQLite (if necessary)

↓

WebSocket

↓

Mission Control

```

This deterministic pipeline simplifies debugging and testing.

---

# Subscriber Model

Each subsystem subscribes only to relevant events.

Example

Mission Control

Subscribes to

- Runtime Events
- Analytics Events
- Task Events

Project Manager

Subscribes to

- Project Events
- Task Events

Collector Engine

Subscribes to

- Filesystem Events

Analytics Engine

Subscribes to

- Runtime Events
- Git Events
- Task Events

This prevents unnecessary processing.

---

# Event Ordering

Events should always be processed in chronological order.

If multiple events occur simultaneously,

their processing order should remain deterministic.

Recommended ordering:

1. Runtime Events

2. Task Events

3. Project Events

4. Analytics Events

5. UI Refresh Events

This ordering minimizes race conditions.

---

# Event Persistence

Not every event should be permanently stored.

Persistent Events

- Task Completed

- Project Created

- Repository Added

- Execution Finished

- Schedule Updated

Transient Events

- Mouse Movement

- Window Resize

- Current FPS

- Temporary Loading States

Only business-significant events belong in SQLite.

---

# Event Reliability

The event system should satisfy the following guarantees.

Every event should have:

- unique identifier

- timestamp

- source

- category

- payload

- version

Example

```json
{
  "id": "evt_9a28b73f",
  "type": "RT-AgentStarted",
  "timestamp": "2026-07-23T08:30:42Z",
  "source": "collector",
  "version": 1,
  "payload": {
    "agent": "Backend Engineer",
    "repository": "fs-llm-service"
  }
}
```

---

# Future Event Bus

Current versions may use direct service communication.

Future versions should introduce an internal Event Bus.

```

Collectors

↓

Event Bus

↓

Application Services

↓

Analytics

↓

Scheduler

↓

Queue Manager

↓

Mission Control

```

The Event Bus becomes the communication backbone of the application.

---

# Event Versioning

Event schemas may evolve over time.

Each event must include a version number.

Older subscribers should continue functioning whenever possible.

Breaking schema changes require a new event version.

This ensures backward compatibility.

---

# Event Monitoring

Mission Control should expose a Live Event Stream for debugging and observability.

The stream should display:

- Event ID
- Event Type
- Source
- Timestamp
- Processing Duration
- Result
- Status

This feature is intended for developers and advanced users.

---

# Architecture Decisions

AD-021

Every meaningful system action must be represented as an event.

---

AD-022

Events are immutable once published.

---

AD-023

Components communicate through events rather than direct dependencies whenever practical.

---

AD-024

Only business-significant events should be persisted.

---

AD-025

Every event must contain a unique identifier, timestamp, source, category, and version.

---
# 10. Technology Decisions

This section documents the architectural decisions regarding technologies used throughout SenJoeru Synapse.

Technology choices are made according to long-term maintainability, developer experience, performance, scalability, and local-first execution.

Individual libraries may change over time.

Architectural principles should remain stable.

---

# Decision Process

Technology decisions should follow these priorities.

1. Simplicity

Prefer simple solutions over complex frameworks.

---

2. Maintainability

The architecture should remain understandable by both humans and AI agents.

---

3. Local First

Technologies should operate without cloud dependencies whenever possible.

---

4. Performance

The platform should remain responsive even while monitoring multiple repositories and AI agents.

---

5. Extensibility

Future technologies should integrate through adapters rather than replacing existing architecture.

---

# Technology Stack

## Desktop Application

Technology

Electron

Purpose

Provides a cross-platform desktop application.

Reasoning

Electron allows Synapse to integrate with:

- Local filesystem
- Native terminals
- Local repositories
- SQLite
- Background services
- WebSocket servers

without requiring a browser environment.

---

## Frontend

Technology

React

Purpose

Mission Control user interface.

Reasoning

React provides:

- Component architecture
- Large ecosystem
- Excellent TypeScript support
- Predictable rendering
- Easy modularization

Mission Control should remain component-driven.

---

## Frontend Build Tool

Technology

Vite

Purpose

Development server and production bundler.

Reasoning

- Extremely fast startup
- Fast HMR
- Simple configuration
- Optimized production builds

---

## Language

Technology

TypeScript

Purpose

Primary language for frontend and backend.

Reasoning

Type safety improves:

- maintainability

- refactoring

- AI-generated code quality

- developer confidence

JavaScript should be minimized whenever practical.

---

## Backend

Technology

Node.js

Purpose

Runtime for backend services.

Reasoning

Node integrates naturally with:

- Electron

- WebSockets

- Filesystem APIs

- Git libraries

- SQLite

The backend should remain lightweight.

---

## API Layer

Technology

Express

Purpose

REST API and middleware.

Reasoning

Express is mature, predictable, and widely supported.

Future migration to Fastify remains possible if performance requirements change.

The API should remain framework-independent.

---

## Real-Time Communication

Technology

WebSocket

Purpose

Live Mission Control updates.

Reasoning

Polling creates unnecessary CPU usage and latency.

WebSocket enables:

- live dashboards

- agent updates

- repository changes

- analytics

- event streaming

Future communication should remain event-driven.

---

## Database

Technology

SQLite

Purpose

Primary application database.

Reasoning

SQLite provides:

- zero configuration

- high performance

- ACID transactions

- excellent local support

- easy backups

- minimal operational complexity

SQLite is sufficient for the expected workload of a desktop application.

---

## Runtime Cache

Technology

JSON

Purpose

Temporary runtime metrics.

Reasoning

JSON remains appropriate for:

- collector output

- temporary metrics

- debugging

- interoperability

JSON is not intended to become the permanent application database.

---

## Version Control

Technology

Git

Purpose

Repository history.

Reasoning

Git remains the authoritative source for repository history.

Synapse observes Git.

It does not replace Git.

---

## AI Execution

Current Provider

Claude Code

Purpose

AI software engineering execution.

Reasoning

Claude performs:

- code generation

- repository analysis

- software implementation

Synapse performs orchestration.

Future providers should integrate through adapters.

---

## Logging

Preferred Strategy

Structured Logging

Every log entry should include:

- Timestamp

- Component

- Severity

- Correlation ID

- Message

Logs should be machine-readable.

---

## Configuration

Preferred Format

Environment Variables

and

Configuration Files

Secrets should never be stored inside repositories.

---

# Technology Selection Principles

Technologies should satisfy the following criteria.

✓ Active maintenance

✓ Strong community support

✓ Cross-platform compatibility

✓ Local execution

✓ TypeScript support

✓ Minimal dependencies

✓ Long-term stability

---

# Technology Replacement Policy

No technology should become tightly coupled with the architecture.

Example

Current

SQLite

Future

PostgreSQL

The Application Layer should remain unchanged.

Only the Data Adapter changes.

---

Current

Express

Future

Fastify

Only the API implementation changes.

Business logic remains identical.

---

Current

Claude Code

Future

Gemini CLI

OpenAI Codex

Qwen Code

Only the Execution Adapter changes.

Mission Control remains unchanged.

---

# Dependency Strategy

Dependencies should be classified into three categories.

Core Dependencies

Required for application execution.

Examples

- Electron

- React

- Express

- SQLite

---

Infrastructure Dependencies

Support the runtime.

Examples

- WebSocket

- File Watchers

- Git Libraries

---

Optional Dependencies

Can be replaced without affecting architecture.

Examples

- UI libraries

- Charts

- Icons

- Themes

---

# Future Technologies

The architecture intentionally allows future integration with:

- MCP Servers

- Local LLMs

- Ollama

- Docker

- Kubernetes

- Remote Agents

- Distributed Workers

These technologies should integrate through adapters rather than modifying the application core.

---

# Architecture Decisions

AD-026

Technology choices should prioritize architectural simplicity over novelty.

---

AD-027

SQLite is the default persistent database for Synapse.

---

AD-028

WebSocket is the preferred mechanism for real-time communication.

---

AD-029

External AI providers integrate through adapters.

---

AD-030

Technology implementations may evolve without changing architectural principles.

---