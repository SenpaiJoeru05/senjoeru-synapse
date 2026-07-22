# SENJOERU SYNAPSE

Version: 1.0

Tagline:
"The Neural Network of Your AI Team"

---

# 1. PROJECT OVERVIEW

SenJoeru Synapse is a desktop AI Agent Operations Center designed to monitor, visualize, and coordinate AI coding agents running on a local developer workstation.

The system acts as a Mission Control dashboard for:

* Claude Code
* Devin
* AI coding agents
* Development tasks
* Git repositories
* Testing pipelines
* Local projects

The application runs entirely on the user's local machine.

No cloud services are required.

---

# 2. PRIMARY GOALS

* Monitor AI agents.
* Track development tasks.
* Visualize AI activities.
* Monitor token usage.
* Track project progress.
* Observe Git activity.
* Display testing results.
* Provide real-time updates.
* Minimize LLM token consumption.
* Serve as an AI Operations Center.

---

# 3. TECHNOLOGY STACK

## Desktop Framework

Electron

## Frontend

* React
* TypeScript
* Vite
* TailwindCSS
* shadcn/ui
* Framer Motion
* Recharts
* Lucide React

## Backend

* Node.js
* Express

## Local Communication

* IPC
* File watchers
* Socket.io (future)

---

# 4. DESIGN LANGUAGE

Design inspiration:

* Linear
* Vercel
* OpenAI
* Cursor
* Claude
* GitHub

Theme:

* Dark mode
* Glassmorphism
* Blue gradients
* Purple accents
* Cyan highlights
* Smooth animations
* Rounded cards
* Neon status indicators

---

# 5. APPLICATION ARCHITECTURE

SenJoeru Synapse
│
├── Electron Shell
├── React Dashboard
├── Monitoring Engine
├── File Watchers
├── Metrics Engine
├── Local Storage
└── System Collectors

---

# 6. MONITORED SOURCES

## Claude Directory

Path:

C:\Users\joelr.claude

READ ONLY.

Directories:

* agents
* sessions
* projects
* history
* cache
* debug
* daemon

The application must never modify Claude files.

---

## Git Repositories

Monitor:

* Current branch
* Last commits
* Modified files
* Repository status

---

## Local Projects

Examples:

* fs-llm-service
* FlowerStore
* Personal projects

---

# 7. DASHBOARD MODULES

## Dashboard Overview

Display:

* Active agents
* Tasks completed
* Running tasks
* System health
* Token usage
* Current project
* Git activity

Cards:

* Active Agents
* Running Tasks
* Tokens Used
* Tests Passing
* Current Session
* System Health

---

## Agent Monitoring

Supported agents:

* Backend Agent
* QA Agent
* Reviewer Agent
* Architect Agent
* Documentation Agent
* Devin Agent
* Claude Agent

Agent information:

* Name
* Status
* Current task
* Progress
* Runtime
* Last update
* Assigned project

Statuses:

* Working
* Reviewing
* Testing
* Idle
* Error

---

## Task Management

Task information:

* Title
* Assigned agent
* Progress
* Status
* ETA
* Priority

Statuses:

* Pending
* Working
* Reviewing
* Completed
* Failed

---

## Activity Timeline

Display:

* Agent events
* Task updates
* Commits
* Test executions
* Errors
* Project updates

---

## Git Dashboard

Display:

* Current branch
* Last commit
* Commit history
* Changed files
* Repository status

---

## Testing Dashboard

Display:

* Passed tests
* Failed tests
* Coverage
* Last execution
* Testing history

---

## Token Analytics

Display:

* Daily tokens
* Weekly tokens
* Session tokens
* Usage trends

Charts:

* Token history
* Session usage

---

## Cost Analytics

Display:

* Daily cost
* Weekly cost
* Monthly cost

Charts:

* Cost trends
* Model usage

---

## System Health

Display:

* CPU usage
* RAM usage
* Disk usage
* Claude storage size
* Session count

---

# 8. REAL-TIME MONITORING

Version 1:

Polling every 5 seconds.

Version 2:

File watchers.

Version 3:

WebSockets.

Updates:

* Agent changes
* New sessions
* Git changes
* Task updates
* Testing results

---

# 9. METRICS STORAGE

metrics/
│
├── agents.json
├── tasks.json
├── tokens.json
├── costs.json
├── tests.json
├── git.json
└── sessions.json

The dashboard reads these files.

The dashboard never asks LLMs for updates.

This minimizes token consumption.

---

# 10. TOKEN CONSUMPTION POLICY

The dashboard must never:

* Ask Claude for status.
* Ask agents for progress repeatedly.
* Continuously consume API calls.

Agents should only update JSON files.

Dashboard reads local files.

Token cost:

Near zero.

---

# 11. USER INTERFACE

Pages:

1. Overview
2. Agents
3. Tasks
4. Analytics
5. Git
6. Testing
7. Activity
8. Settings

---

# 12. FUTURE FEATURES

* Claude integration
* MCP monitoring
* AI model analytics
* Multi-project support
* VS Code extension
* Desktop notifications
* System tray widget
* Agent communication graph
* Token forecasting
* AI performance scoring

---

# 13. SECURITY

* Local only.
* No cloud dependency.
* Read-only access to Claude files.
* No automatic modifications.
* No external uploads.

---

# 14. PROJECT STRUCTURE

senjoeru-synapse/
│
├── electron/
├── frontend/
├── backend/
├── collectors/
├── metrics/
├── docs/
├── assets/
└── tests/

---

# 15. APPLICATION NAME

SenJoeru Synapse

Subtitle:

AI Agent Operations Center

Tagline:

"The Neural Network of Your AI Team"

---

# 16. SUCCESS CRITERIA

The application should allow the user to:

* Observe AI agents.
* Monitor projects.
* Track tasks.
* View progress.
* Monitor costs.
* Analyze tokens.
* Follow Git activity.
* Understand system health.

Without consuming additional LLM tokens.

The application acts as the command center of the user's AI engineering workflow.
