# Setup Guide

## Prerequisites

- Python 3.11+
- Node.js + npm
- Network access to your organization's Bitbucket Server (Stash) and Jira instances
- A Stash access token and a Jira API token

## Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # fill in your Stash/Jira URLs and tokens
uvicorn app.main:app --reload --port 8000
```

Ask the project maintainer for the correct values to put in `.env` — the example file contains placeholders only.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Serves the dashboard at `http://localhost:5173`.

## Verifying it's running

```bash
curl http://localhost:8000/health
```

Should return `{"status": "ok"}`. If setup issues come up beyond this, check with the project maintainer before making changes to configuration or code.
