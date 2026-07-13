# Setup Guide

> Covers Approach 1 (component-mapping pipeline) only.

## Prerequisites

- Python 3.11+ (backend uses `pydantic-settings`, `fastapi`, `apscheduler`, `httpx`)
- Node.js + npm (frontend is Vite + React 18)
- Network access to your organization's Bitbucket Server (Stash) and Jira Cloud instances
- A Stash personal access token (bearer token) with read access to the target project's repos
- A Jira API token tied to an account with permission to read the issues/components you need to query

There are no automated tests and no linting configuration in this repo (backend or frontend) — setup is limited to installing dependencies and configuring environment variables.

## 1. Backend setup

```bash
cd backend
python -m venv venv
```

Activate the virtual environment — you'll need to do this again every time you open a new terminal to work on the backend (your prompt will show `(venv)` once it's active):

- **Mac / Linux**: `source venv/bin/activate`
- **Windows (Command Prompt)**: `venv\Scripts\activate.bat`
- **Windows (PowerShell)**: `venv\Scripts\Activate.ps1`

```bash
pip install -r requirements.txt
```

### Configure environment variables

Copy the checked-in example file and fill in real values:

```bash
cp .env.example .env
```

`backend/.env` (gitignored — never commit this file) must define:

| Variable | Purpose | Example |
|---|---|---|
| `STASH_BASE_URL` | Base URL of your Bitbucket Server instance | `https://stash.mediaocean.com` |
| `STASH_TOKEN` | Bearer token for Stash REST API auth | `<personal access token>` |
| `STASH_PROJECT_KEY` | Bitbucket project key containing the repos to scan | `SO` |
| `STASH_REPO_ALLOWLIST` | Optional comma-separated repo slugs to scope scanning to; empty = scan every repo in `STASH_PROJECT_KEY` | `global-invoice,edi-invoice,...` |
| `JIRA_BASE_URL` | Base URL of your Jira Cloud instance | `https://mediaocean.atlassian.net` |
| `JIRA_EMAIL` | Email of the Jira account associated with the API token | `you@company.com` |
| `JIRA_TOKEN` | Jira API token (Basic auth, paired with `JIRA_EMAIL`) | `<api token>` |
| `POLL_INTERVAL_MINUTES` | How often the background poller re-scans Stash | `15` |
| `COMMIT_LOOKBACK_DAYS` | How far back the poller looks for new commits on its first run | `30` |
| `FRONTEND_URL` | Origin allowed by CORS (must match where the frontend is served) | `http://localhost:5173` |

**Important**: the values in `.env.example` and in this table are illustrative placeholders (`stash.example.com`, `<Your STASH_PROJECT_KEY>`, etc.), not literal values. Use your organization's real base URLs and the actual Bitbucket project key that contains your repos — using the wrong project key means the poller will scan zero or the wrong repos.

**Where to get the tokens:**
- **`STASH_TOKEN`**: log in to Stash → your avatar (top right) → Manage Account → Personal Access Tokens → Create token. Give it read access to repositories.
- **`JIRA_TOKEN`**: log in to Jira → your avatar → Profile → Personal Access Tokens → Create token. Needs read access to the tickets/components this pipeline will query.

`pydantic-settings` reads `.env` once at process startup (cached via `@lru_cache` on `get_settings()`). If you edit `.env` while the backend is running, **restart the process** — there is no hot-reload of configuration (only of code, via `--reload`).

### Run the backend

```bash
uvicorn app.main:app --reload --port 8000
```

Verify it started:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

If `/health` doesn't work, the app itself isn't running — check the terminal for a Python traceback (usually a missing dependency or a malformed `.env`) before investigating anything Stash/Jira-related.

If `/health` works but `/api/commits` fails, verify:
- VPN/network access to `STASH_BASE_URL` (the API returns a 503 with a VPN hint if the connection fails outright)
- `STASH_TOKEN` is valid and not expired
- `STASH_PROJECT_KEY` matches a real project your token can read

## 2. Frontend setup

```bash
cd frontend
npm install
npm run dev
```

This serves the dashboard at `http://localhost:5173` by default. It expects the backend to be reachable at `/api/*` — in local dev this is proxied to `http://localhost:8000` by Vite's dev server config; in a deployed setup, `FRONTEND_URL` in the backend's `.env` must match the origin the frontend is actually served from (for CORS to allow it).

For a production-style build:

```bash
npm run build      # outputs to frontend/dist/
npm run preview    # serve the production build locally to sanity-check it
```

## 3. Verifying the full pipeline works end-to-end

1. Confirm `GET /health` returns `{"status": "ok"}`.
2. Confirm `GET /api/commits?since_days=7` returns real commits (not an empty list, unless your repos genuinely have no commits in that window).
3. Open the frontend, select a time window, and click **Run Pipeline**. This calls `/api/trace`, which fetches commits and resolves them through the Jira ticket/component chain.
4. Click the **Recommended Tests** tab. This triggers `/api/tests`, which runs the full selector + ranker and queries Jira for actual Selenium test cases — expect this to take 30–60 seconds on a cold cache, since it fans out real Jira JQL searches.

If step 3 returns commits but every one shows `no_component` or `no_permission`, check the `JIRA_TOKEN`/`JIRA_EMAIL` pair and confirm that account has read access to the tickets being referenced — this pipeline depends entirely on being able to read each commit's linked Jira ticket.

## Stopping the app / freeing stuck ports

In each terminal, `Ctrl + C` stops the server. If a port is still reported as in use the next time you try to start it:

```bash
lsof -ti :8000 | xargs kill -9   # backend
lsof -ti :5173 | xargs kill -9   # frontend
```

## Quick-reference checklist (first-time setup)

| Step | What | Command |
|---|---|---|
| 1 | Clone the repo | `git clone <repo-url> && cd smart-regression-optimizer` |
| 2 | Go into backend folder | `cd backend` |
| 3 | Create virtual environment | `python -m venv venv` |
| 4 | Activate virtual environment | `source venv/bin/activate` (see OS variants above) |
| 5 | Install Python packages | `pip install -r requirements.txt` |
| 6 | Create `.env` file | `cp .env.example .env` → fill in real credentials |
| 7 | Go into frontend folder | `cd ../frontend` |
| 8 | Install Node packages | `npm install` |
| 9 | Start backend (Terminal 1) | `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000` |
| 10 | Start frontend (Terminal 2) | `cd frontend && npm run dev` |
| 11 | Open the app | `http://localhost:5173` |

Once set up, day-to-day startup is just steps 9–11.
