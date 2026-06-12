# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart Regression Optimizer is a POC for Mediaocean that intelligently selects regression test cases when code changes are detected. It polls Bitbucket Server (Stash) for new commits, extracts Jira ticket IDs from commit messages, and recommends relevant Selenium test cases via Jira queries.

## Running the Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend requires a `.env` file in `backend/` with these variables:

```
STASH_BASE_URL=https://stash.example.com
STASH_TOKEN=<bearer token>
STASH_PROJECT_KEY=CM
JIRA_BASE_URL=https://jira.example.com
JIRA_EMAIL=user@example.com
JIRA_TOKEN=<api token>
POLL_INTERVAL_MINUTES=15
COMMIT_LOOKBACK_DAYS=30
FRONTEND_URL=http://localhost:5173
```

## Running the Frontend

The frontend is a React/Vite app. From `frontend/`:

```bash
npm install
npm run dev   # serves on http://localhost:5173
```

## API Endpoints

All routes are prefixed with `/api`:

- `GET /api/commits?since_days=7&limit=100` — list recent commits across all repos
- `GET /api/tests?since_days=7` — run selector + ranker and return recommended test cases
- `GET /api/events?limit=20` — return stored regression events (from background poller)
- `POST /api/events/trigger` — manually trigger a poll cycle
- `GET /health` — health check

## Architecture

### Data Flow

```
Stash API → commits (with ADINFRA-*/IAPP-* ticket IDs)
         → selector.py → jira_service.py → test cases
         → ranker.py → scored + sorted TestCase list
         → stored as RegressionEvent in event_store (in-memory)
```

### Background Poller

`app/core/scheduler.py` uses APScheduler to run `run_poll()` on a configurable interval. The poller tracks `_last_seen` commit IDs per repo to emit only net-new commits each cycle. Events accumulate in the module-level `event_store` list (resets on restart — no persistence).

### Test Selection Logic (`services/selector.py`)

For each commit there are two paths:

1. **Tag-based (primary)**: If the commit references Jira tickets (ADINFRA-* or IAPP-*), fetch the ticket's `Tag` custom field (customfield_10313). The tag encodes repo slugs like `campaign-management:2026.5.80`. Those slugs are looked up in `backend/config/repo_component_mapping.json` to find Jira component names, then a JQL search retrieves test cases in those components.

2. **Repo fallback**: If no Jira ticket is found in the commit message, or the ticket has no Tag field, the commit's own repo slug is looked up directly in `repo_component_mapping.json`.

`select_tests_for_commits()` deduplicates by ticket ID before firing Jira requests to avoid redundant API calls.

### Ranking Logic (`services/ranker.py`)

Each test case gets an `impact_score` (0–1.0) from:
- **Base weight** — derived from the `sub_component` prefix (e.g. `CM-` = 1.0, `MP-` = 0.9 … `REP-` = 0.4)
- **Layer bonus** — +0.1 if found via Layer 1 (direct issue link traversal) vs Layer 2 (component search)
- **Overlap bonus** — +0.1 if the test's component prefix appears in the commit's ticket IDs

### Jira Service (`services/jira_service.py`)

- `SELENIUM_FILTER` — JQL fragment filtering for automated Selenium tests (checks `cf[11133]`, `cf[10158]`, `cf[10159]` custom fields and excludes TV/radio label categories)
- Uses `asyncio.Semaphore(5)` to cap concurrent Jira requests; `_tag_cache` prevents re-fetching the same ticket within a poll cycle
- Jira pagination uses the `nextPageToken` cursor (Jira API v3 `/rest/api/3/search/jql`)
- `layer1_traverse()` — unused in current main path; walks `issuelinks` of type "Relates" to find IAPP suite parents
- `layer2_component_search()` — active path; JQL `component = "X"` search

### Component Mapping (`backend/config/repo_component_mapping.json`)

Maps Stash repo slug → `{ "Jira Component Name": ["sub-component-1", ...] }`. The sub-component strings are Jira sub-component values that drive the ranker's base weight. Updating this file is the primary way to tune which test areas get triggered by a given repo.

### Models (`app/models/schemas.py`)

- `Commit` — id, message, author, timestamp, repo, jira_tickets
- `TestCase` — jira_id, summary, component, sub_component, layer_found, impact_score
- `CoverageGap` — repo, commit_id, jira_tickets, reason (`no_jira_link` | `no_test_cases_found`)
- `RegressionEvent` — aggregates commits + recommended tests + gaps from one poll cycle