# Setup Guide — Smart Regression Optimizer

Everything you need to go from a fresh clone to a running app. Read top to bottom if this is your first time.

---

## Prerequisites

You need these installed on your machine before anything else:

| Tool | Version used | Install |
|---|---|---|
| Python | 3.11+ | https://python.org/downloads |
| Node.js | 20+ | https://nodejs.org |
| npm | 10+ | comes with Node |
| git | any | https://git-scm.com |

Check you have them:
```bash
python3 --version    # should print 3.11.x or higher
node --version       # should print v20.x or higher
npm --version        # should print 10.x or higher
```

---

## Step 1 — Clone the Repo

```bash
git clone <repo-url>
cd smart-regression-optimizer
```

---

## Step 2 — Backend Setup

All backend work happens inside the `backend/` folder.

### 2a. Create a virtual environment

A virtual environment keeps Python packages isolated from your system Python. You only do this once per machine.

```bash
cd backend
python3 -m venv venv
```

This creates a `venv/` folder inside `backend/`. Do not commit this folder (it's already in `.gitignore`).

### 2b. Activate the virtual environment

You must activate the venv **every time you open a new terminal** to work on the backend.

**Mac / Linux:**
```bash
source venv/bin/activate
```

**Windows (Command Prompt):**
```bash
venv\Scripts\activate.bat
```

**Windows (PowerShell):**
```bash
venv\Scripts\Activate.ps1
```

Your terminal prompt will change to show `(venv)` at the start — that means it's active.

### 2c. Install Python dependencies

```bash
pip install -r requirements.txt
```

This installs FastAPI, uvicorn, httpx, and all other backend packages. Only needs to be run once (or again if `requirements.txt` changes).

### 2d. Create the `.env` file

The backend reads credentials from a `.env` file. This file is **not** in git (it contains secrets). Create it manually:

```bash
# You should be inside the backend/ folder
touch .env
```

Open `.env` in any text editor and paste this, filling in the real values:

```
STASH_BASE_URL=https://stash.mediaocean.com
STASH_TOKEN=<your Bitbucket personal access token>
STASH_PROJECT_KEY=CM

JIRA_BASE_URL=https://jira.mediaocean.com
JIRA_EMAIL=<your Jira email address>
JIRA_TOKEN=<your Jira API token>

POLL_INTERVAL_MINUTES=15
COMMIT_LOOKBACK_DAYS=30
FRONTEND_URL=http://localhost:5173
```

**Where to get the tokens:**
- **STASH_TOKEN**: Log in to Stash → your avatar (top right) → Manage Account → Personal Access Tokens → Create token. Give it read access to repositories.
- **JIRA_TOKEN**: Log in to Jira → your avatar → Profile → Personal Access Tokens → Create token. Needs read access to ADINFRA project.

---

## Step 3 — Frontend Setup

Open a **second terminal** (keep the backend terminal open separately).

```bash
cd frontend          # from the project root
npm install
```

This installs React, Vite, and all frontend packages into `node_modules/`. Only needs to be run once (or again if `package.json` changes).

---

## Step 4 — Running the App

You need **two terminals running at the same time** — one for the backend, one for the frontend.

### Terminal 1 — Backend

```bash
cd backend
source venv/bin/activate      # activate venv (every time)
uvicorn app.main:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Application startup complete.
[app] Poller started — interval: 15 min
```

The `--reload` flag means the backend automatically restarts whenever you edit a Python file. You do not need to manually restart it during development.

### Terminal 2 — Frontend

```bash
cd frontend
npm run dev
```

You should see:
```
VITE v5.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
```

### Open the app

Go to **http://localhost:5173** in your browser.

The frontend proxies all `/api` requests to the backend at port 8000, so both must be running.

---

## Day-to-Day Workflow (Returning Developer)

Every time you sit down to work:

```bash
# Terminal 1 — backend
cd smart-regression-optimizer/backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd smart-regression-optimizer/frontend
npm run dev
```

That's it. The app is at **http://localhost:5173**.

---

## API Endpoints

The backend runs at `http://localhost:8000`. All routes are prefixed with `/api`:

| Method | Endpoint | What it does |
|---|---|---|
| GET | `/api/trace?since_days=7` | Full pipeline trace — commits → tickets → components → test search |
| GET | `/api/commits?since_days=7` | Raw list of recent commits across all repos |
| GET | `/api/tests?since_days=7` | Run test selector + ranker, return recommended test cases |
| GET | `/api/events?limit=20` | Return stored regression events from background poller |
| POST | `/api/events/trigger` | Manually trigger a poll cycle |
| GET | `/api/commits/{repo}/{commit_id}/files` | Files changed in a specific commit |
| GET | `/api/commits/{repo}/{commit_id}/diff?path={file}` | Line-level diff for one file in a commit |
| GET | `/api/debug/ticket/{ticket_id}` | Raw Jira fields for a ticket (diagnostic tool) |
| GET | `/health` | Health check — returns 200 if backend is up |

You can also browse the auto-generated API docs at **http://localhost:8000/docs**.

---

## Stopping the App

In each terminal, press `Ctrl + C` to stop the server.

If a port is stuck in use when you try to restart:

```bash
# Kill whatever is using port 8000
lsof -ti :8000 | xargs kill -9

# Kill whatever is using port 5173
lsof -ti :5173 | xargs kill -9
```

---

## Project Structure

```
smart-regression-optimizer/
├── backend/
│   ├── app/
│   │   ├── api/routes/api.py       — all API route handlers
│   │   ├── core/
│   │   │   ├── config.py           — reads .env into Settings object
│   │   │   └── scheduler.py        — APScheduler background poller
│   │   ├── models/schemas.py       — Pydantic models (Commit, TestCase, etc.)
│   │   ├── services/
│   │   │   ├── stash_service.py    — Bitbucket Stash API calls
│   │   │   ├── jira_service.py     — Jira API calls + test case search
│   │   │   ├── selector.py         — maps commits → test cases
│   │   │   ├── ranker.py           — scores test cases by relevance
│   │   │   └── trace_service.py    — builds per-commit pipeline trace
│   │   └── main.py                 — FastAPI app entry point + CORS setup
│   ├── config/
│   │   └── repo_component_mapping.json
│   ├── requirements.txt
│   ├── .env                        — secrets (not in git, create manually)
│   └── venv/                       — Python virtual environment (not in git)
│
├── frontend/
│   ├── src/
│   │   ├── pages/Dashboard.jsx     — main UI: By Repo / By Ticket tabs
│   │   ├── utils/api.js            — fetch helpers for all backend endpoints
│   │   ├── App.jsx                 — root component
│   │   └── App.css                 — all styles
│   ├── package.json
│   ├── vite.config.js              — dev server config + /api proxy to :8000
│   └── node_modules/               — npm packages (not in git)
│
├── documentation/                  — session notes, decisions, roadmap
├── Setup.md                        — this file
└── CLAUDE.md                       — instructions for Claude Code
```

---

## Troubleshooting

**`Address already in use` when starting uvicorn**
Port 8000 is still occupied from a previous run. Run: `lsof -ti :8000 | xargs kill -9` then start uvicorn again.

**`ModuleNotFoundError` when starting uvicorn**
The virtual environment is not activated. Run `source venv/bin/activate` first (you should see `(venv)` in your prompt).

**`No such file or directory: .env`**
Create the `.env` file manually inside `backend/` — see Step 2d above. The app will start but all API calls will fail without it.

**Frontend shows "Could not load trace" or no data**
Check that the backend is running at port 8000. Open http://localhost:8000/health in your browser — it should return `{"status":"ok"}`. If not, the backend is down.

**`Stash returned HTTP 401` or `403` in the terminal**
Your `STASH_TOKEN` in `.env` is missing, expired, or doesn't have read access to the CM project. Generate a new personal access token in Stash.

**`Jira returned HTTP 401` or `403` in the terminal**
Your `JIRA_TOKEN` in `.env` is missing or expired. Generate a new personal access token in Jira.

**Files show "Stash returned HTTP 400" in the diff viewer**
This Stash Server uses `until=` (not `at=`) as the commit parameter in the diff endpoint. If you see this after an upgrade or environment change, check `stash_service.py → get_commit_diff()`.

---

## Quick Reference — First-Time Setup Checklist

Run through this in order when setting up on a new machine.

| Step | What | Command |
|---|---|---|
| 1 | Clone the repo | `git clone <repo-url> && cd smart-regression-optimizer` |
| 2 | Go into backend folder | `cd backend` |
| 3 | Create virtual environment | `python3 -m venv venv` |
| 4 | Activate virtual environment | `source venv/bin/activate` |
| 5 | Install Python packages | `pip install -r requirements.txt` |
| 6 | Create `.env` file | `touch .env` → fill in credentials (see Step 2d) |
| 7 | Go into frontend folder | `cd ../frontend` |
| 8 | Install Node packages | `npm install` |
| 9 | Start backend (Terminal 1) | `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000` |
| 10 | Start frontend (Terminal 2) | `cd frontend && npm run dev` |
| 11 | Open the app | http://localhost:5173 |
