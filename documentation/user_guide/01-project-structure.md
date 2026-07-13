# Project Structure

> Approach 1 (component-mapping pipeline) only. This guide intentionally excludes the coverage-based / JaCoCo Test Impact Analysis (TIA) trial pipeline (`app/services/coverage/`, `app/api/routes/coverage.py`, `app/models/coverage_schemas.py`, `frontend/src/pages/CoverageDashboard.jsx`, `frontend/src/components/CoverageComparison.jsx`, `backend/tools/`) — those files are gitignored and out of scope for this documentation set.

## Top-level layout

```
smart-regression-optimizer/
├── backend/            FastAPI service — polls Stash, queries Jira, ranks tests
├── frontend/            React/Vite single-page dashboard
├── documentation/       Living project docs (roadmap, decisions, sessions, this guide)
└── CLAUDE.md             Instructions for Claude Code when working in this repo
```

## Backend (`backend/`)

```
backend/
├── app/
│   ├── main.py                        FastAPI app instance, CORS, lifespan (starts/stops the poller)
│   ├── core/
│   │   ├── config.py                  Settings (env-var driven), see 02-setup-guide.md
│   │   └── scheduler.py               APScheduler background poller + in-memory event_store
│   ├── api/routes/
│   │   └── api.py                     All active HTTP endpoints (commits, tests, trace, events, debug)
│   ├── models/
│   │   └── schemas.py                 Pydantic models: Commit, TestCase, CoverageGap, RegressionEvent, etc.
│   └── services/
│       ├── stash_service.py           Bitbucket Server (Stash) REST client
│       ├── jira_service.py            Jira REST client — ticket lookups, JQL test search, caching
│       ├── selector.py                Ticket → component → test-case selection logic
│       ├── ranker.py                  Impact-score computation and sorting
│       └── trace_service.py           Per-commit diagnostic trace (drives /api/trace)
├── config/
│   └── tag_component_mapping.json     Tag slug → {component, sub_component} map (see note below)
├── requirements.txt
└── .env.example                       Checked-in, credential-free reference for required env vars
```

> **Note on `tag_component_mapping.json`**: this is the live mapping used by `jira_service.resolve_component_for_slug()`. Each repo slug extracted from a ticket's `Tag` field is looked up under `tag_overrides`; slugs not listed there fall back to `default_component` (currently `"Global Invoices"`) with no sub-component filter. Add new tag overrides here — no code changes needed. The old `repo_component_mapping.json` (never wired into the code) has been deleted.

Two route modules (`app/api/routes/commits.py`, `events.py`, `tests.py`) and three frontend components (`CommitTable.jsx`, `EventsFeed.jsx`, `TestRecommendations.jsx`) exist as empty (0-line) files — dead scaffolding from an earlier intended module split that was never followed through. All real endpoint logic lives in `api.py`; all real UI logic lives inline in `Dashboard.jsx`.

## Frontend (`frontend/`)

```
frontend/
├── src/
│   ├── main.jsx              Vite/React entry point
│   ├── App.jsx               Top nav shell — toggles between Approach 1 and Approach 2 views
│   ├── App.css                Shared styles/CSS custom properties (--primary, --border, etc.)
│   ├── pages/
│   │   └── Dashboard.jsx      The entire Approach 1 UI: filter bar, tabs, all view components inline
│   └── utils/
│       └── api.js             fetch() wrappers for backend endpoints
├── package.json
└── vite.config.js
```

There is no router library installed (no `react-router-dom`) — navigation between the two top-level approaches is local React state in `App.jsx`, not URL-based.

## Documentation (`documentation/`)

```
documentation/
├── roadmap/            project-roadmap.md — single source of truth for status/next steps
├── sessions/           Chronological session logs (what happened, what was decided, per session)
├── decisions/          Durable decision records by topic (stakeholder alignment, tag-based resolution, etc.)
├── architecture/        Structural/UX decisions (e.g. dashboard split) — some entries reference Approach 2
├── setup/               Local dev environment notes
├── tooling/              Notes on internal tooling (e.g. the docwork skill)
└── user_guide/           This documentation set — structure, setup, implementation, user manual
```
