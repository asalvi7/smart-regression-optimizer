# User Manual

## What this application does

Watches your Bitbucket repositories for new commits, links them to Jira tickets, and recommends automated regression tests likely relevant to those changes — so QA can run a smaller, targeted test set instead of the full suite.

## Starting the application

```bash
# Terminal 1 — backend
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open `http://localhost:5173`.

## Using the dashboard

1. Pick a time window and click **Run Pipeline** to scan recent commits.
2. Review the ticket/commit trace to see what was found.
3. Open the **Recommended Tests** tab to see the suggested test cases.

Not every commit or ticket will produce a recommendation — some are filtered out as out of scope. If results look wrong or missing, check with the project maintainer rather than assuming it's a bug.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Backend won't start | Confirm `.env` is filled in and dependencies installed |
| Dashboard shows no data | Confirm the backend is running on port 8000 |
| Unexpected results | Ask the project maintainer — the selection rules are tuned deliberately |
