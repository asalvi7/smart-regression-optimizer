# Smart Regression Optimizer

A proof-of-concept for Mediaocean that intelligently selects regression test cases when code changes are detected. It polls Bitbucket Server (Stash) for new commits, extracts Jira ticket IDs from commit messages, and recommends relevant automated regression test cases via Jira — so QA can run a smaller, targeted regression set instead of the full suite after every change.

## How it works

```
Stash commits → Jira ticket (from commit message) → ticket's "Product" field (Prisma only)
             → ticket's "Tag" field → repo slug → Jira component/sub-component
             → JQL search for automated regression tests → ranked by priority + frequency
```

A background poller re-scans on a configurable interval and keeps a rolling history of results; a React dashboard lets you run the pipeline on demand, trace exactly how each commit resolved (or didn't), and drill into files/diffs.

## Quick start

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # fill in your Stash/Jira URLs and tokens
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev              # http://localhost:5173
```

## Documentation

Full documentation lives under [`documentation/user_guide/`](documentation/user_guide/):

| Guide | Covers |
|---|---|
| [01-project-structure.md](documentation/user_guide/01-project-structure.md) | Repo layout, what each module does |
| [02-setup-guide.md](documentation/user_guide/02-setup-guide.md) | Installation, environment configuration, verifying the pipeline works |
| [03-implementation-details.md](documentation/user_guide/03-implementation-details.md) | How ticket resolution, ranking, and tracing actually work in code |
| [04-user-manual.md](documentation/user_guide/04-user-manual.md) | How to use the dashboard, interpret results, and troubleshoot |
| [05-docker-deployment.md](documentation/user_guide/05-docker-deployment.md) | Docker/single-VM deployment |

See `CLAUDE.md` for guidance oriented at AI coding assistants working in this repo.

## Tech stack

- **Backend**: Python, FastAPI, APScheduler, httpx
- **Frontend**: React 18, Vite (no router library — single-page view toggle)
- **External systems**: Bitbucket Server (Stash) REST API, Jira Cloud REST API v3

There are no automated tests or linting configuration in this repo.

## API summary

All routes are prefixed with `/api`. See [03-implementation-details.md](documentation/user_guide/03-implementation-details.md) for details.

- `GET /api/commits` — recent commits across all repos
- `GET /api/tests` — run the selector + ranker, return recommended test cases
- `GET /api/trace` — per-commit diagnostic trace (ticket → tag → component resolution)
- `GET /api/events` / `POST /api/events/trigger` — background poller history / manual trigger
- `GET /api/commits/{repo}/{commit_id}/files` and `.../diff` — file/diff drill-down
- `GET /health` — health check
