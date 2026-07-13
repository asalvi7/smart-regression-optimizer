# Implementation Details

> Covers Approach 1 (component-mapping pipeline) only. Reflects the actual current code paths, not aspirational design — where behavior differs from what you might expect from file/variable names, that's called out explicitly.

## Data flow, end to end

```
Stash API → commits (filtered to those with ADINFRA-*/IAPP-* ticket IDs in the message,
                       and to STASH_REPO_ALLOWLIST repos if that's set)
         → for each commit's ticket(s): fetch the ticket's Product field (customfield_10169)
         → keep only tickets where Product contains "Prisma" — everything else is dropped silently
         → fetch the ticket's "Tag" field; if empty, drop silently (no Tag = no functional impact assumed)
         → extract repo slug(s) from the Tag field text
         → resolve each slug to a (component, sub_component) pair via tag_component_mapping.json
         → JQL search for eligible ST-Test Case issues matching those component/sub-component pairs
         → ranker.py sorts the resulting test cases (frequency, then priority)
         → (background poller path only) stored as a RegressionEvent in event_store (in-memory, resets on restart)
```

The Product/Tag filtering happens in that exact order — Product first (cheap, decisive), Tag second — and both exclusions are silent: no `CoverageGap` entry, no dashboard clutter. See `documentation/decisions/prisma-ingestion-scope.md` for the reasoning.

## Background poller (`app/core/scheduler.py`)

- `create_scheduler()` wires an `AsyncIOScheduler` (APScheduler) to run `run_poll()` on an interval (`POLL_INTERVAL_MINUTES`), started/stopped by the FastAPI app's `lifespan` context in `main.py`.
- `run_poll()` fetches recent commits per repo, diffs them against `_last_seen` (a module-level dict of repo → last-seen commit ID) to emit only net-new commits, then runs them through `select_tests_for_commits()` + `rank_tests()` and appends a `RegressionEvent` to the front of `event_store`.
- `event_store` is a plain in-memory list — it is **not persisted**. A backend restart discards all accumulated events. `POST /api/events/trigger` runs `run_poll()` on demand outside the schedule.

## Commit ingestion (`app/services/stash_service.py`)

- `get_all_repos()` paginates through all repos in `STASH_PROJECT_KEY` via Stash's `/rest/api/1.0/projects/{key}/repos` endpoint, then filters the result to `STASH_REPO_ALLOWLIST` if that env var is set (comma-separated repo slugs). This filtering happens once at the source, so every downstream consumer — the poller, `/api/trace`'s `repos_scanned` count, `get_repos_with_recent_commits()` — automatically inherits the scoping.
- `get_commits_since(repo_slug, since)` paginates a repo's commit history against `refs/heads/master`, stopping as soon as it hits a commit older than the `since` cutoff. Commits whose message starts with `[jenkins-release]` are filtered out.
- `TICKET_PATTERN` is a regex (`\b(?:ADINFRA|IAPP)-\d+\b`) applied to each commit message to extract Jira ticket IDs; duplicates within a single commit message are deduped and uppercased.
- `get_repos_with_recent_commits(since_days)` fans this out across all repos concurrently, capped at 10 concurrent Stash requests via an `asyncio.Semaphore`.
- `get_commit_files()` / `get_commit_diff()` back the file-list and diff-drill-down UI in the dashboard; both explicitly handle merge commits by retrying against the first parent when the naive diff comes back empty.
- `get_file_content_at_commit()` fetches raw file content at a revision — this exists to support the coverage/TIA trial's diff parser and is not used by any Approach 1 code path.

## Ticket resolution and test selection (`app/services/jira_service.py`, `app/services/selector.py`)

This is the part most likely to differ from what you'd expect reading older documentation:

- `get_ticket_details(ticket_id)` fetches a Jira issue's `Tag` custom field (`customfield_10313`) and `Product` field (`customfield_10169`, multi-select). It returns `is_prisma: bool` (whether `"Prisma"` is among the Product values), and extracts repo slug(s) from the Tag field's free text (`extract_repo_slugs_from_tag`, a regex over patterns like `campaign-management:2026.5.80` or `campaign-management/2026.5.110`), then resolves each slug to a `(component, sub_component)` pair via `resolve_component_for_slug()`, which looks the slug up in `backend/config/tag_component_mapping.json`. Slugs not listed under that file's `tag_overrides` fall back to `default_component` (currently `"Global Invoices"`) with no sub-component filter.
- **`selector.py` applies two silent scope checks, in order, before ever searching for tests**: (1) skip the ticket entirely if `is_prisma` is false, (2) skip the ticket entirely if it has no Tag (`slugs` is empty). Neither produces a `CoverageGap` — they're treated as out-of-scope noise, not pipeline failures. Only a ticket that's Product=Prisma *and* has a Tag proceeds to test search; if that search comes back empty, *that* does produce a `CoverageGap` (`no_test_cases_found`). See `documentation/decisions/prisma-ingestion-scope.md`.
- `search_tests_by_tag_slugs(slugs)` resolves each slug to a component/sub-component clause — `(cf[10205] = "X" AND cf[10206] in ("Y", "Z"))`, or just `(cf[10205] = "X")` when there's no sub-component override — OR's the distinct clauses together, ANDs that against `TEST_CASE_FILTER`, and appends `ORDER BY "Latest date"`. Results are cached by the sorted tuple of clauses for the life of the process (`_search_cache` — no TTL, cleared only on restart). **`cf[10205]`/`cf[10206]`** ("Components - Prisma" / "Sub-Components - Prisma") are custom fields specific to this Jira instance, confirmed via `GET /rest/api/3/field` — this instance does *not* use Jira's system `component` field for Prisma work, and an earlier version of this code incorrectly queried the system field plus a nonexistent `cf[10100]`, which silently returned zero results. See `documentation/decisions/component-resolution-from-tag.md`.
- `TEST_CASE_FILTER` is the JQL fragment that restricts results to eligible automated regression test cases: `(project = ADINFRA OR project = Prisma OR project = IAPP)`, `type = "ST-Test Case"`, a Regression flag, `Automated = Yes`, a non-empty test script ID (`cf[10225]`), and excludes issues marked `Retired` on any of the Automated dropdown variants.
- Each matched test case also carries its **own** `priority_id`, read from the test case issue's `priority` field (not inherited from whichever dev ticket triggered it). This Jira instance's priority scheme is custom — confirmed via `GET /rest/api/3/priority`: `1=Critical, 2=High, 3=Medium, 4=Low, 10000=TBD` — not Jira's generic Highest/High/Medium/Low/Lowest default.
- Two functions, `layer1_traverse()` (walks `issuelinks` of type "Relates" to find IAPP suite parents) and `layer2_component_search()` (a per-component, non-batched JQL search), exist in `jira_service.py` but are **not called anywhere in the active selector path** — `selector.py` calls `get_ticket_details()` + `search_tests_by_tag_slugs()` directly. Treat these two functions as unused/legacy unless you're the one wiring them back in.
- `_JIRA_SEMAPHORE` and `_SEARCH_SEMAPHORE` each cap concurrency at 3 to avoid Jira 429 rate-limit responses; `_jql_search()` retries up to 3 times on 429, honoring the `Retry-After` header when present.
- `selector.select_tests_for_commits()` dedupes by ticket ID before firing Jira lookups (avoiding redundant requests across commits that reference the same ticket), then aggregates per-test `frequency` (how many distinct tickets triggered it) across the whole run.

## Ranking (`app/services/ranker.py`)

`rank_tests(tests)` sorts the deduplicated `TestCase` list by `(-frequency, priority severity)` — most-triggered first, ties broken by the test case's own priority (Critical → TBD). There is no computed score field; `TestCase` doesn't carry an `impact_score` at all. An earlier version of this pipeline computed a 4-factor weighted `impact_score` (a sub-component category base weight, a layer bonus, a commit-ID-overlap bonus, plus priority/frequency bonuses); two of those four factors were found to be inert against real data (see `documentation/decisions/test-case-ranking.md`), and the whole derived score was later dropped as redundant once Priority and Frequency were already shown as their own columns in the UI.

## Pipeline trace (`app/services/trace_service.py`)

`build_pipeline_trace(since_days)` produces the diagnostic behind `/api/trace` and the dashboard's "By Repo" / "By Ticket" views. For each commit it records:

- `tickets` — extracted Jira IDs
- `ticket_tags` — raw Tag field text per ticket
- `ticket_slugs` — repo slugs extracted from that tag
- `ticket_components` / `ticket_sub_components` — resolved component/sub-component names
- `ticket_is_prisma` — whether each ticket's Product field contains "Prisma"
- `ticket_status` — **per-ticket** status, one of `matched`, `not_prisma`, `no_tag`, `no_component`, `no_permission` — mirrors the exact same Product→Tag→component check order as `selector.py`, so the trace never disagrees with what actually reaches Recommended Tests
- `status` — the commit-level aggregate: `matched` if any ticket matched, otherwise the highest-priority reason among its tickets (`no_permission` > `not_prisma` > `no_tag` > `no_component`), or `no_ticket` if the commit referenced no Jira ID at all

All ticket lookups are pre-fetched concurrently up front and then read from `jira_service`'s in-process cache while building each trace, so re-running the trace within the same process lifetime for overlapping commits doesn't re-hit Jira.

## API layer (`app/api/routes/api.py`)

All active Approach 1 endpoints live in this single module (see `01-project-structure.md` for the note on the dead `commits.py`/`events.py`/`tests.py` stub files). Endpoints wrap their core logic in try/except blocks that convert `httpx` connection/HTTP errors into appropriate FastAPI `HTTPException`s (503 for unreachable Stash, 502 for a bad Stash response, 500 with the exception detail for anything else in `/api/tests`).

## Frontend (`frontend/src/pages/Dashboard.jsx`)

Single-file implementation of the entire Approach 1 UI:

- **Filter bar**: a time-window `<select>` (7/14/30/60/90 days) and a **Run Pipeline** button that calls `fetchTrace(days)` (→ `GET /api/trace`).
- **By Repo tab**: still implemented (commits grouped by repo, a 4-step pipeline trace per commit) but its tab button is commented out in `Dashboard.jsx` — currently hidden from the UI, not deleted.
- **🎫 Dev Tickets tab** (internal state key `by-ticket`, labeled "DEV TICKETS" in the UI): trace data grouped by Jira ticket, **filtered to only tickets that passed both the Product=Prisma and has-Tag checks** (`ticket_status !== 'not_prisma' && !== 'no_tag'`) — a hidden-ticket count is shown in the toolbar for transparency. Each ticket card shows Product, Tag, Component, Sub-Component, and a plain-English "Test search" sentence (not raw JQL), plus a drill-down per commit into changed files and diffs (`fetchCommitFiles` / `fetchCommitDiff`, lazy-loaded on click). Ticket cards default to collapsed, with "Expand all"/"Collapse all" controls.
- **🧪 Recommended Tests tab**: lazily triggers `fetchTests(days)` (→ `GET /api/tests`) only the first time the tab is opened, then renders a table of test cases sorted by frequency/priority: Jira ID (linked to the real Jira host), summary, component, priority badge (Critical/High/Medium/Low/TBD — click the header to sort), and frequency. No score column — that was removed. Paginated 20 at a time with a **Load more** button.
- The top KPI strip shows Repos scanned / With changes / Commits / Unique tickets / Matched — all computed from the same in-scope (Product+Tag-filtered) ticket set the Dev Tickets tab uses, so the numbers agree across the dashboard. There is no "Gaps" tile in the strip anymore.

There is no shared state between tabs beyond the single `data` (trace) and `tests` results — each is fetched independently and cached in component state for the session.
