# Project Structure

> High-level overview only. For questions about specific modules or how a piece works internally, ask the project maintainer.

## Top-level layout

```
smart-regression-optimizer/
├── backend/            FastAPI service — polls Stash, queries Jira, ranks tests
├── frontend/            React/Vite dashboard
├── documentation/       Project docs
└── CLAUDE.md             Instructions for AI coding assistants working in this repo
```

## Backend (`backend/`)

- `app/main.py` — FastAPI app entry point
- `app/core/` — settings and the background poller
- `app/api/routes/` — HTTP endpoints
- `app/models/` — data models
- `app/services/` — Stash/Jira integration and test-selection logic
- `config/` — mapping configuration
- `.env.example` — reference for required environment variables

## Frontend (`frontend/`)

- `src/App.jsx` — app shell
- `src/pages/Dashboard.jsx` — the dashboard UI
- `src/utils/api.js` — backend API calls

## Documentation (`documentation/`)

This `user_guide/` folder is the public-facing reference set. For deeper implementation detail, architecture history, or design rationale, contact the project maintainer.
