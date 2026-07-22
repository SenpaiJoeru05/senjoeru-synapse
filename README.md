# SenJoeru Synapse

**The Neural Network of Your AI Team**

A desktop AI Agent Operations Center designed to monitor, visualize, and coordinate AI coding agents running on a local developer workstation.

## Features

- Monitor AI agents (Claude, Devin, etc.)
- Track development tasks
- Visualize AI activities
- Monitor token usage and costs
- Track project progress
- Observe Git activity
- Display testing results
- Real-time updates
- Zero LLM token consumption for monitoring

## Tech Stack

- **Desktop**: Electron
- **Frontend**: React, TypeScript, Vite, TailwindCSS, shadcn/ui, Framer Motion, Recharts
- **Backend**: Node.js, Express
- **Monitoring**: File watchers, IPC

## Getting Started

```bash
# Install dependencies
npm install

# Run development mode
npm run dev

# Build for production
npm run build
```

## Architecture

```
senjoeru-synapse/
├── electron/       # Electron main process
├── frontend/       # React dashboard
├── backend/        # Express API server
├── collectors/     # Data collectors
├── metrics/        # Metrics storage (JSON)
└── docs/          # Documentation
```

## Security

- Local only - no cloud services
- Read-only access to Claude files
- No automatic modifications
- No external uploads
