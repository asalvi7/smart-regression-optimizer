# User Manual

> How to install, configure, and use the Smart Regression Optimizer dashboard (Approach 1 — component-mapping pipeline).

## What this application does

Smart Regression Optimizer watches your Bitbucket Server (Stash) repositories for new commits, extracts any Jira ticket IDs referenced in the commit messages, and recommends which automated Selenium regression tests are likely relevant to those changes — based on the Jira ticket's `Tag` field and the Jira component it maps to. The goal is to help a QA/release team run a smaller, targeted set of regression tests instead of the full suite after every change.

## Installation

See `02-setup-guide.md` for full detail. In short:

1. Install backend dependencies: `cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
2. Install frontend dependencies: `cd frontend && npm install`

## Configuration

Before first use, create `backend/.env` (copy `backend/.env.example` as a starting point) and fill in:

- Your Stash server URL and a valid bearer token
- The Bitbucket **project key** containing the repos you want scanned
- Your Jira Cloud URL, account email, and API token
- How often you want the background poller to re-check for new commits (`POLL_INTERVAL_MINUTES`)
- How far back the first scan should look (`COMMIT_LOOKBACK_DAYS`)

Restart the backend after any change to `.env` — configuration is only read at startup.

## Starting the application

Two processes need to run simultaneously, each in its own terminal:

```bash
# Terminal 1 — backend
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev
```

Open the URL printed by the frontend command (default `http://localhost:5173`) in a browser.

## Using the dashboard

### 1. Choose a time window and run the pipeline

At the top of the page, pick how far back to scan (7, 14, 30, 60, or 90 days) and click **▶ Run Pipeline**. This is the first thing to do every time you load the page — nothing loads automatically. Expect this to take 30–60 seconds on the first run, since it's scanning every repo in your configured Bitbucket project and querying Jira for each referenced ticket.

If this fails, the error banner will suggest the most common cause (e.g., "Is the backend running on port 8000?").

### 2. Read the summary strip

After a run completes, a row of stats appears: repos scanned, repos with changes, commits processed, unique tickets, how many resolved successfully (**Matched**), and how many didn't (**Gaps**).

### 3. Explore results — three tabs

- **📁 By Repo** — commits grouped by which repository they landed in. Click a repo header to expand/collapse its commit list; click an individual commit to see its 4-step trace (which repo → which ticket → what the ticket's Tag/component resolved to → what test search will run). A status badge on each commit tells you at a glance whether it resolved (✓ Matched), has no ticket (— No ticket), the ticket had no usable component (⚠ No component), or Jira access was denied (🔒 No permission).
- **🎫 By Ticket** — the same underlying data, but grouped by Jira ticket ID instead of repo. Each ticket card shows its Tag field, resolved component(s), the exact JQL query that will be run, and every commit that referenced it. Click a commit row to see its changed files, and click a file to see its diff inline (or a link to open it directly in Stash if it's too large to render).
- **🧪 Recommended Tests** — click this tab to trigger the actual test-selection run (separate from the trace above, since it queries Jira for real test issues and takes longer). Once loaded, you get a sortable-by-relevance table of every recommended Selenium test case: its Jira ID (linked out to your Jira instance), summary, component, priority, how many tickets/commits triggered it (frequency), and an impact-score badge (Critical/High/Medium/Low). Results are paginated 20 at a time with a **Load more** button.

### 4. Interpreting gaps

Not every commit will produce test recommendations, and that's expected — a "gap" isn't necessarily a bug in the tool. Common reasons, visible directly in the trace:

- **No ticket** — the commit message didn't contain a recognizable `ADINFRA-*` or `IAPP-*` ticket ID.
- **No component** — the ticket was found, but its `Tag` custom field was empty or didn't parse into a usable repo slug.
- **No permission** — the Jira account configured in `.env` doesn't have access to read that ticket. Check `JIRA_TOKEN`/`JIRA_EMAIL` if you see this often.

### 5. Triggering an out-of-band scan (background poller)

The backend also runs its own scan on a fixed interval (`POLL_INTERVAL_MINUTES`) independent of the dashboard, storing results as "events." This is exposed via:

- `GET /api/events` — see recently stored poll results
- `POST /api/events/trigger` — manually kick off a poll cycle immediately, without waiting for the interval

These are plain HTTP endpoints (no dedicated UI page in this version of the app) — use `curl`, Postman, or a browser for `GET /api/events`.

## Troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| "Cannot reach Stash server" error | VPN not connected, or `STASH_BASE_URL` wrong | Confirm VPN, re-check `.env` |
| Every commit shows "No permission" | Jira token/account lacks read access | Verify `JIRA_TOKEN` and `JIRA_EMAIL` in `.env`, restart backend |
| Recommended Tests tab returns 0 tests | Tickets have no Tag field, or Tag doesn't resolve to a real Jira component | Open the By Ticket tab and inspect the ticket's Tag/Component fields directly |
| Nothing loads at all in the browser | Backend not running, or CORS mismatch | Confirm `uvicorn` is running on port 8000; confirm `FRONTEND_URL` in `.env` matches the frontend's actual origin |
| Diff view says "Old data — re-run the pipeline" | Commit IDs were truncated in a previous run (pre-restart) | Click Run Pipeline again to refresh with full commit SHAs |
