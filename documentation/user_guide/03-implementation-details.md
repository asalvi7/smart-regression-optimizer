# Implementation Details

> Summary level only. This project's selection/ranking logic has specific rules and tuning that aren't documented here — for anything beyond this overview, talk to the project maintainer before changing behavior.

## Data flow, roughly

```
Stash commits → linked Jira ticket → ticket scope checks →
resolved Jira component/sub-component → matching test cases →
ranked list → shown on the dashboard
```

A background poller also re-scans on an interval and keeps recent results in memory.

## Where things live

- `app/services/stash_service.py` — talks to Bitbucket/Stash
- `app/services/jira_service.py` — talks to Jira, resolves tickets to test cases
- `app/services/selector.py` — decides which tickets/tests are in scope
- `app/services/ranker.py` — orders the resulting test list
- `app/services/trace_service.py` — powers the diagnostic trace view

## API

All endpoints are under `/api`. See the running backend or ask the maintainer for the current endpoint list — it changes as the project evolves.
