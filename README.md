# Smart Regression Optimizer

A POC tool that intelligently selects regression test cases by analyzing recent code changes across Mediaocean's Campaign Management (CM) repositories in Bitbucket Stash, then maps those changes to relevant Jira test cases — so only impacted tests run instead of the full suite.

## Architecture

```
Backend  →  Python + FastAPI  →  Bitbucket Stash REST API
                               →  Jira REST API (Part 2)
Frontend →  React + Vite
```

---

## Local Setup

### Prerequisites

- Python 3.11+
- Node.js 18+

---

### Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Configure credentials
cp .env.example .env
# Edit .env and fill in STASH_BASE_URL, STASH_TOKEN

# Start the API server
uvicorn app.main:app --reload --port 8000
```

API will be available at `http://localhost:8000`.
Interactive docs: `http://localhost:8000/docs`

---

### Frontend

```bash
cd frontend

npm install
npm run dev
```

App will be available at `http://localhost:5173`.

---

## API Reference

### `GET /api/repos/active`

Returns all CM repos that had commits in the specified date range.

**Query parameters (choose one form):**

| Param   | Type   | Description                                     |
|---------|--------|-------------------------------------------------|
| `range` | string | Preset: `today`, `last_7d`, `last_30d`, `last_90d` |
| `from`  | string | Custom start date: `YYYY-MM-DD`                 |
| `to`    | string | Custom end date: `YYYY-MM-DD`                   |

**Example:**
```
GET /api/repos/active?range=last_30d
GET /api/repos/active?from=2026-05-01&to=2026-06-09
```

**Response:**
```json
{
  "date_range": { "from_date": "2026-05-10", "to_date": "2026-06-09" },
  "total_repos_scanned": 45,
  "active_repos": 12,
  "repos": [
    {
      "name": "campaign-management",
      "slug": "campaign-management",
      "commit_count": 47,
      "last_commit_date": "2026-06-09",
      "authors": ["rrajesh", "jenkins"],
      "repo_url": "https://stash.mediaocean.com/projects/CM/repos/campaign-management/browse"
    }
  ]
}
```

---

## Project Structure

```
smart-regression-optimizer/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── config.py            # Settings from .env
│   │   ├── routers/stash.py     # /api/repos/active endpoint
│   │   ├── services/stash_service.py  # Stash API calls (async/concurrent)
│   │   ├── models/stash_models.py     # Pydantic response models
│   │   └── utils/date_utils.py        # Date range helpers
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── pages/Dashboard.jsx
    │   ├── components/
    │   │   ├── DateRangeFilter.jsx
    │   │   └── RepoTable.jsx
    │   └── services/api.js
    ├── package.json
    └── vite.config.js
```

---

## Status

| Part | Description | Status |
|------|-------------|--------|
| Part 1 | Identify repos with recent commits (Stash) | ✅ Complete |
| Part 2 | Map repos → Jira test cases | 🔜 Coming next |
