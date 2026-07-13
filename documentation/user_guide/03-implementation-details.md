# Implementation Details

> Covers Approach 1 (component-mapping pipeline) only. Reflects the actual current code paths, not aspirational design — where behavior differs from what you might expect from file/variable names, that's called out explicitly.

## Data flow, end to end

```
Stash API → commits (filtered to those with ADINFRA-*/IAPP-* ticket IDs in the message)
         → for each commit's ticket(s): fetch Jira ticket's "Tag" field
         → extract repo slug(s) from the Tag field text
         → use those slugs directly as Jira component names
         → JQL search for Selenium-tagged test issues in those components
         → ranker.py scores and sorts the resulting test cases
         → (background poller path only) stored as a RegressionEvent in event_store (in-memory, resets on restart)
```

## Background poller (`app/core/scheduler.py`)

- `create_scheduler()` wires an `AsyncIOScheduler` (APScheduler) to run `run_poll()` on an interval (`POLL_INTERVAL_MINUTES`), started/stopped by the FastAPI app's `lifespan` context in `main.py`.
- `run_poll()` fetches recent commits per repo, diffs them against `_last_seen` (a module-level dict of repo → last-seen commit ID) to emit only net-new commits, then runs them through `select_tests_for_commits()` + `rank_tests()` and appends a `RegressionEvent` to the front of `event_store`.
- `event_store` is a plain in-memory list — it is **not persisted**. A backend restart discards all accumulated events. `POST /api/events/trigger` runs `run_poll()` on demand outside the schedule.

## Commit ingestion (`app/services/stash_service.py`)

- `get_all_repos()` paginates through all repos in `STASH_PROJECT_KEY` via Stash's `/rest/api/1.0/projects/{key}/repos` endpoint.
- `get_commits_since(repo_slug, since)` paginates a repo's commit history against `refs/heads/master`, stopping as soon as it hits a commit older than the `since` cutoff. Commits whose message starts with `[jenkins-release]` are filtered out.
- `TICKET_PATTERN` is a regex (`\b(?:ADINFRA|IAPP)-\d+\b`) applied to each commit message to extract Jira ticket IDs; duplicates within a single commit message are deduped and uppercased.
- `get_repos_with_recent_commits(since_days)` fans this out across all repos concurrently, capped at 10 concurrent Stash requests via an `asyncio.Semaphore`.
- `get_commit_files()` / `get_commit_diff()` back the file-list and diff-drill-down UI in the dashboard; both explicitly handle merge commits by retrying against the first parent when the naive diff comes back empty.
- `get_file_content_at_commit()` fetches raw file content at a revision — this exists to support the coverage/TIA trial's diff parser and is not used by any Approach 1 code path.

## Ticket resolution and test selection (`app/services/jira_service.py`, `app/services/selector.py`)

This is the part most likely to differ from what you'd expect reading `repo_component_mapping.json` or older documentation:

- `get_ticket_details(ticket_id)` fetches a Jira issue's `Tag` custom field (`customfield_10313`) and `priority`. It extracts repo slug(s) from the Tag field's free text (`extract_repo_slugs_from_tag`, a regex over patterns like `campaign-management:2026.5.80` or `campaign-management/2026.5.110`), then **uses those slugs directly as the Jira component names to search on** — there is no intermediate lookup into `repo_component_mapping.json`. That file exists in `backend/config/` but is currently dead weight; nothing in the code imports or reads it.
- If the ticket's Tag field is empty or the ticket can't be read (403/404 → `no_permission`; 401 → `auth_failed`), `components` comes back empty and `selector.py` records a `CoverageGap` with reason `no_component_on_ticket`.
- `search_tests_by_components(component_names)` builds one batched JQL query (`component in ("A", "B", ...)` + `SELENIUM_FILTER`) rather than one query per component, and caches results by the sorted tuple of component names for the life of the process (`_search_cache` — no TTL, cleared only on restart).
- `SELENIUM_FILTER` is the JQL fragment that restricts results to automated Selenium tests: checks `cf[11133]`/`cf[10158]` (Automation Tool, migrated/old field IDs) and `cf[10159]` (Automated = "Yes"), and excludes TV/radio-only label categories.
- Two functions, `layer1_traverse()` (walks `issuelinks` of type "Relates" to find IAPP suite parents) and `layer2_component_search()` (a per-component, non-batched JQL search), exist in `jira_service.py` but are **not called anywhere in the active selector path** — `selector.py` calls `get_ticket_details()` + `search_tests_by_components()` directly. Treat these two functions as unused/legacy unless you're the one wiring them back in.
- `_JIRA_SEMAPHORE` and `_SEARCH_SEMAPHORE` each cap concurrency at 3 to avoid Jira 429 rate-limit responses; `_jql_search()` retries up to 3 times on 429, honoring the `Retry-After` header when present.
- `selector.select_tests_for_commits()` dedupes by ticket ID before firing Jira lookups (avoiding redundant requests across commits that reference the same ticket), then aggregates per-test `frequency` (how many commits/tickets triggered it) and keeps the highest-severity (`ticket_priority_id`) seen for each test across all triggering tickets.

## Ranking (`app/services/ranker.py`)

Every `TestCase` gets an `impact_score` computed as the sum of:

| Component | Range | Basis |
|---|---|---|
| Base weight | 0.3 – 1.0 | Longest matching prefix of `sub_component` against a fixed table (`CM-`=1.0, `MP-`=0.9, …, `BI-`=0.4; unmatched defaults to 0.3) |
| Layer bonus | 0 or +0.1 | +0.1 if `layer_found == 1` (currently never true in the active path, since layer 1 traversal isn't called) |
| Overlap bonus | 0 or +0.1 | +0.1 if the test's sub-component prefix (before the first `-`) appears, case-insensitively, in the concatenated ticket IDs of the triggering commits |
| Frequency bonus | 0 – +0.3 | +0.1 per additional commit beyond the first that triggered this test, capped at +0.3 |
| Priority bonus | 0 – +0.3 | Based on `ticket_priority_id`: Highest=+0.3, High=+0.2, Medium=+0.1, Low/Lowest=+0.0 |

Results are sorted descending by the final rounded score. Because `sub_component` is currently always empty (`search_tests_by_components` sets `sub_component=""` — see note below), every test case's base weight resolves to the 0.3 default unless that changes.

> **Note**: `search_tests_by_components()` in `jira_service.py` does populate `sub_component` from `customfield_10100` when present on the matched Jira test issue — so the "always empty" case only applies if that custom field is genuinely unset on the test issue, not universally. Verify against real data in your Jira instance before assuming the base-weight table is inert.

## Pipeline trace (`app/services/trace_service.py`)

`build_pipeline_trace(since_days)` produces the diagnostic behind `/api/trace` and the dashboard's "By Repo" / "By Ticket" views. For each commit it records:

- `tickets` — extracted Jira IDs
- `ticket_tags` — raw Tag field text per ticket
- `ticket_slugs` — repo slugs extracted from that tag
- `ticket_components` / `ticket_sub_components` — resolved component/sub-component names
- `status` — one of `matched` (at least one ticket resolved to a component), `no_ticket` (no Jira ID in the commit message), `no_component` (ticket found, no usable Tag/component), `no_permission` (403/404/401 reading the ticket)

All ticket lookups are pre-fetched concurrently up front and then read from `jira_service`'s in-process cache while building each trace, so re-running the trace within the same process lifetime for overlapping commits doesn't re-hit Jira.

## API layer (`app/api/routes/api.py`)

All active Approach 1 endpoints live in this single module (see `01-project-structure.md` for the note on the dead `commits.py`/`events.py`/`tests.py` stub files). Endpoints wrap their core logic in try/except blocks that convert `httpx` connection/HTTP errors into appropriate FastAPI `HTTPException`s (503 for unreachable Stash, 502 for a bad Stash response, 500 with the exception detail for anything else in `/api/tests`).

## Frontend (`frontend/src/pages/Dashboard.jsx`)

Single-file implementation of the entire Approach 1 UI:

- **Filter bar**: a time-window `<select>` (7/14/30/60/90 days) and a **Run Pipeline** button that calls `fetchTrace(days)` (→ `GET /api/trace`).
- **By Repo tab**: commits grouped by repo, each rendered as a collapsible card showing a 4-step pipeline trace (Repo → Ticket → Jira ticket/Tag/Component → Test search) with a status badge.
- **By Ticket tab**: the same trace data regrouped by Jira ticket, with per-ticket metadata (tag, components, JQL used) and a drill-down per commit into changed files and their diffs (`fetchCommitFiles` / `fetchCommitDiff`, lazy-loaded on click).
- **Recommended Tests tab**: lazily triggers `fetchTests(days)` (→ `GET /api/tests`) only the first time the tab is opened, then renders a paginated (20-at-a-time) table of ranked test cases with priority/frequency/impact-score badges.

There is no shared state between tabs beyond the single `data` (trace) and `tests` results — each is fetched independently and cached in component state for the session.
