# Setup Guide

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Python | 3.11+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |

---

## 1. Clone the Repository

```bash
git clone <https://github.com/asalvi7/smart-regression-optimizer>
cd smart-regression-optimizer
```

---

## 2. Backend Setup

### 2.1 Create and activate a virtual environment

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
```

> Your terminal prompt will show `(venv)` once the environment is active.

### 2.2 Install dependencies

```bash
pip install -r requirements.txt
```

### 2.3 Configure credentials

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```
STASH_BASE_URL=https://stash.mediaocean.com
STASH_TOKEN=<your Stash personal access token>
STASH_PROJECT_KEY=CM

JIRA_BASE_URL=https://jira.mediaocean.com
JIRA_TOKEN=<your Jira personal access token>
```

To generate a Stash personal access token:
1. Log in to Stash
2. Go to **Profile → Manage Access Tokens**
3. Create a token with **Read** permission on repositories

### 2.4 Start the backend server

```bash
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive API docs: `http://localhost:8000/docs`

---

## 3. Frontend Setup

Open a **new terminal tab** (keep the backend running).

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

---

## 4. Verify Everything Works

1. Open `http://localhost:8000/health` — should return `{"status": "ok"}`
2. Open `http://localhost:5173` — the dashboard should load and auto-fetch repos for the last 30 days

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `zsh: command not found: python` | Use `python3` instead |
| `ModuleNotFoundError` | Make sure `(venv)` is active before running uvicorn |
| `401 Unauthorized` from Stash | Check `STASH_TOKEN` in `.env` |
| Frontend shows no data | Ensure backend is running on port 8000 before starting frontend |
| First load takes 30–40s | Expected — backend queries all CM repos concurrently |
