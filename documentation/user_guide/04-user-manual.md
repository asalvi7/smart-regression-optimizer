# User Manual

> How to install, configure, and use the Smart Regression Optimizer dashboard (Approach 1 — component-mapping pipeline).

## What this application does

Smart Regression Optimizer watches your Bitbucket Server (Stash) repositories for new commits, extracts any Jira ticket IDs referenced in the commit messages, and recommends which automated regression tests are likely relevant to those changes — based on the Jira ticket's `Product` field (only "Prisma" tickets are considered), its `Tag` field, and the Jira component/sub-component that Tag maps to. The goal is to help a QA/release team run a smaller, targeted set of regression tests instead of the full suite after every change.

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

At the top of the page, pick how far back to scan (7, 14, 30, 60, or 90 days) and click **▶ Run Pipeline**. This is the first thing to do every time you load the page — nothing loads automatically. Expect this to take 30–60 seconds on the first run, since it's scanning every allowlisted repo in your configured Bitbucket project and querying Jira for each referenced ticket.

If this fails, the error banner will suggest the most common cause (e.g., "Is the backend running on port 8000?").

### 2. Read the summary strip

After a run completes, a row of stats appears: repos scanned, repos with changes, commits processed, unique tickets, and how many resolved successfully (**Matched**). These counts only include tickets that are in scope — see step 4 below — so they'll agree with what you see on the Dev Tickets tab.

### 3. Explore results

- **🎫 DEV TICKETS** — trace data grouped by Jira ticket ID, showing only tickets that passed the Product=Prisma and has-Tag scope checks (step 4 below). Each ticket card (collapsed by default — click to expand, or use "Expand all"/"Collapse all") shows Product, Tag, resolved Component/Sub-Component, a plain-English description of what test search will run, and every commit that referenced it. Click a commit row to see its changed files, and click a file to see its diff inline (or a link to open it directly in Stash if it's too large to render).
- **🧪 RECOMMENDED TESTS** — click this tab to trigger the actual test-selection run (separate from the trace above, since it queries Jira for real test issues and takes longer). Once loaded, you get a table of every recommended test case: its Jira ID (linked out to your Jira instance), summary, component, a priority badge (**Critical** / **High** / **Medium** / **Low** / **TBD** — this is the test case's *own* Jira priority, not the priority of the dev ticket that triggered it), and how many tickets triggered it (frequency). Click the **Priority** column header to sort by severity (click again to reverse, a third click returns to the default order). Results are paginated 20 at a time with a **Load more** button.

A "By Repo" view also exists in the code (commits grouped by repository instead of ticket) but its tab is currently hidden from the UI.

### 4. Scope: which tickets actually show up

Not every ticket referenced by a commit will appear on the Dev Tickets tab or produce test recommendations — this is expected, and most of the filtering is silent by design (no gap/error shown, since these are considered out-of-scope noise, not pipeline failures):

- **Product ≠ Prisma** — the ticket's `Product` field doesn't include "Prisma". Dropped silently.
- **No Tag** — the ticket is Prisma, but has no `Tag` field set (treated as a dev-only ticket with no functional area to trace). Dropped silently.
- **No ticket** — the commit message didn't contain a recognizable `ADINFRA-*` or `IAPP-*` ticket ID at all. Shown in a separate "Untracked Commits" section at the bottom of the Dev Tickets tab.
- **No permission** — the Jira account configured in `.env` doesn't have access to read that ticket. This *does* show as a distinct status, since it's an actionable configuration problem, not expected noise. Check `JIRA_TOKEN`/`JIRA_EMAIL` if you see this often.
- **No test cases found** — the ticket passed both scope checks and resolved to a real component/sub-component, but Jira has no automated regression test case matching it. This is the one case that still shows as a visible gap, since it's a genuine coverage question worth investigating.

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
| Recommended Tests tab returns 0 tests | Tickets aren't Product=Prisma, have no Tag field, or the resolved component has no matching automated test cases in Jira | Open the Dev Tickets tab and inspect the ticket's Product/Tag/Component fields directly |
| Nothing loads at all in the browser | Backend not running, or CORS mismatch | Confirm `uvicorn` is running on port 8000; confirm `FRONTEND_URL` in `.env` matches the frontend's actual origin |
| Diff view says "Old data — re-run the pipeline" | Commit IDs were truncated in a previous run (pre-restart) | Click Run Pipeline again to refresh with full commit SHAs |
