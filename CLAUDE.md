# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Before Starting Any Work

**Always read the documentation folder first.** Before answering questions, planning, or writing code, check the relevant docs:

| What you need | Where to look |
|---|---|
| Where the project is headed and what step we're on | `documentation/roadmap/project-roadmap.md` |
| Why the project exists and what was built in Parts 1 & 2 | `documentation/sessions/parts-1-and-2-build.md` |
| Stakeholder feedback and what was approved/rejected | `documentation/decisions/objective-1-stakeholder-alignment.md` |
| What happened in the last session and what was decided | `documentation/sessions/session-05-performance-and-reliability.md` |
| Design and rationale for the coverage-based (JaCoCo TIA) trial pipeline | `documentation/decisions/coverage-based-test-impact-analysis.md` |
| Why the two pipelines got split into separate top-level dashboards | `documentation/architecture/dashboard-separation.md` |
| Local `.env` setup and real project-key/URL corrections | `documentation/setup/local-dev-environment.md` |

The roadmap is the single source of truth for current status, next steps, open questions, and working principles. **Read it before proposing anything.**

## Project Overview

Smart Regression Optimizer is a POC for Mediaocean that intelligently selects regression test cases when code changes are detected. It polls Bitbucket Server (Stash) for new commits, extracts Jira ticket IDs from commit messages, and recommends relevant Selenium test cases via Jira queries.

## Running the Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend requires a `.env` file in `backend/` (copy `backend/.env.example`, which is checked in and credential-free) with these variables:

```
STASH_BASE_URL=https://stash.example.com
STASH_TOKEN=<bearer token>
STASH_PROJECT_KEY=CM
JIRA_BASE_URL=https://jira.example.com
JIRA_EMAIL=user@example.com
JIRA_TOKEN=<api token>
POLL_INTERVAL_MINUTES=15
COMMIT_LOOKBACK_DAYS=30
FRONTEND_URL=http://localhost:5173
```

Note: the values above are illustrative placeholders from `app/core/config.py`'s `Settings` defaults, not literal values to use — see `documentation/setup/local-dev-environment.md` for the real Mediaocean project key/host corrections made the first time this was run locally.

Optional coverage-trial settings (safe to leave at defaults if not running that pipeline): `COVERAGE_INDEX_DB_PATH` (default `data/coverage_index.db`), `COVERAGE_EXEC_DROPBOX_DIR` (default `data/coverage_raw`), `JACOCO_REPORT_HELPER_JAR` (default `tools/jacoco-report-helper/target/jacoco-report-helper.jar`).

## Running the Frontend

The frontend is a React/Vite app. From `frontend/`:

```bash
npm install
npm run dev      # serves on http://localhost:5173
npm run build    # production build into frontend/dist/
```

There are no automated tests in this repo (backend or frontend). No linting config exists.

The frontend has no routing library — `App.jsx` toggles between two full-page components (`Dashboard` for the component-mapping pipeline, `CoverageDashboard` for the coverage-based TIA trial) via local `view` state, not URLs. Each page owns its own filter/run-trigger state independently.

## API Endpoints

All routes are prefixed with `/api`. Component-mapping pipeline (`api.py`):

- `GET /api/commits?since_days=7&limit=100` — list recent commits across all repos
- `GET /api/tests?since_days=7` — run selector + ranker and return recommended test cases
- `GET /api/trace?since_days=7` — per-commit diagnostic trace showing ticket→tag→component resolution status (`matched` | `no_ticket` | `no_component` | `no_permission`)
- `GET /api/events?limit=20` — return stored regression events (from background poller)
- `POST /api/events/trigger` — manually trigger a poll cycle
- `GET /api/commits/{repo}/{commit_id}/files` — list files changed in one commit (requires full 40-char SHA)
- `GET /api/commits/{repo}/{commit_id}/diff?path=<file>` — parsed diff for one file in a commit
- `GET /api/debug/ticket/{ticket_id}` — dump all non-null Jira fields for a ticket (used to discover custom field IDs)
- `GET /health` — health check

Coverage-based TIA trial pipeline (`coverage.py`, see Architecture below):

- `GET /api/tests/coverage-based?since_days=7` — run the coverage (JaCoCo reverse-index) pipeline standalone
- `GET /api/coverage/compare?since_days=7` — run both pipelines over the same commit window and return agreement/divergence stats
- `GET /api/coverage/index/stats` — diagnostic snapshot of reverse-index freshness (tests indexed, class/method entry counts, latest capture, app versions)
- `POST /api/coverage/ingest` — manually trigger ingestion of pending `.exec` dumps from the dropbox dir

## Architecture

### Data Flow

```
Stash API → commits (with ADINFRA-*/IAPP-* ticket IDs)
         → selector.py → jira_service.py → test cases
         → ranker.py → scored + sorted TestCase list
         → stored as RegressionEvent in event_store (in-memory)
```

### Background Poller

`app/core/scheduler.py` uses APScheduler to run `run_poll()` on a configurable interval. The poller tracks `_last_seen` commit IDs per repo to emit only net-new commits each cycle. Events accumulate in the module-level `event_store` list (resets on restart — no persistence).

### Test Selection Logic (`services/selector.py`)

For each commit there are two paths:

1. **Tag-based (primary)**: If the commit references Jira tickets (ADINFRA-* or IAPP-*), fetch the ticket's `Tag` custom field (customfield_10313). The tag encodes repo slugs like `campaign-management:2026.5.80`. Those slugs are looked up in `backend/config/repo_component_mapping.json` to find Jira component names, then a JQL search retrieves test cases in those components.

2. **Repo fallback**: If no Jira ticket is found in the commit message, or the ticket has no Tag field, the commit's own repo slug is looked up directly in `repo_component_mapping.json`.

`select_tests_for_commits()` deduplicates by ticket ID before firing Jira requests to avoid redundant API calls.

### Ranking Logic (`services/ranker.py`)

Each test case gets an `impact_score` (0–1.0) from:
- **Base weight** — derived from the `sub_component` prefix (e.g. `CM-` = 1.0, `MP-` = 0.9 … `REP-` = 0.4)
- **Layer bonus** — +0.1 if found via Layer 1 (direct issue link traversal) vs Layer 2 (component search)
- **Overlap bonus** — +0.1 if the test's component prefix appears in the commit's ticket IDs

### Pipeline Trace (`services/trace_service.py`)

`build_pipeline_trace()` returns a `PipelineTraceResponse` — a per-commit diagnostic showing how each commit resolved through the pipeline (ticket found → tag extracted → components matched). Used by `/api/trace` to debug why a commit did or didn't produce test recommendations.

### Jira Service (`services/jira_service.py`)

- `SELENIUM_FILTER` — JQL fragment filtering for automated Selenium tests (checks `cf[11133]`, `cf[10158]`, `cf[10159]` custom fields and excludes TV/radio label categories)
- `_JIRA_SEMAPHORE(3)` caps concurrent ticket lookups; `_SEARCH_SEMAPHORE(3)` caps concurrent test search queries. Both were tuned down from 5 to reduce Jira 429s.
- `_tag_cache` prevents re-fetching the same ticket within a poll cycle; `_search_cache` (keyed by sorted component tuple) caches test search results for the server lifetime — no TTL, cleared only on restart.
- Test searches use batched JQL: `component in ("A", "B", "C")` fires one request instead of one per component.
- `_jql_search` retries on 429 up to 3 times, respecting the `Retry-After` header.
- Jira pagination uses the `nextPageToken` cursor (Jira API v3 `/rest/api/3/search/jql`)
- `layer1_traverse()` — unused in current main path; walks `issuelinks` of type "Relates" to find IAPP suite parents
- `layer2_component_search()` — active path; JQL `component = "X"` search

### Coverage-Based TIA Trial Pipeline (`backend/app/services/coverage/`)

An unproven parallel pipeline (not a replacement) that answers test selection with a reverse-index lookup instead of the Jira component/tag chain: "what methods/classes did this commit change, and which tests are known to execute them." It never imports from, and is never imported by, the component-mapping pipeline (`selector.py`/`ranker.py`/`jira_service.py`) — `coverage.py` and `app/services/coverage/` can be deleted wholesale with zero impact on `/api/tests`, `/api/trace`, `/api/events`. Full design rationale in `documentation/decisions/coverage-based-test-impact-analysis.md`.

- **`diff_parser.py`** — resolves a commit's changed lines down to Java method/class granularity using `tree-sitter-java` (chosen over `javalang`/a JavaParser subprocess to avoid a JVM dependency in the request path). Falls back to attributing a change to all overloads of a class when overload resolution is ambiguous (`ImpactedSymbol.ambiguous`).
- **`tia_selector.py`** — `select_tests_for_commits_coverage()` is the coverage-pipeline counterpart to `selector.select_tests_for_commits()`: fetches each commit's diff via `stash_service.py` (reused, not duplicated), resolves symbols via `diff_parser.py`, and looks them up in the reverse index.
- **`index_store.py`** — SQLite-backed reverse index (`backend/data/coverage_index.db`, path configurable), chosen over in-memory (must survive restarts — rebuilding means re-running the full instrumented suite) and over Postgres (single-instance POC, batch not concurrent writes). Schema: `coverage_runs` (one row per ingested `.exec` dump) + `class_coverage` (per-class/method line-coverage-ratio rows), indexed by `(app_repo, class_name[, method_name])`.
- **`jacoco_report.py`** — invokes the Java helper subprocess (`backend/tools/jacoco-report-helper/`) to convert a raw `.exec` dump + `.class` files into JSON coverage data. The only JVM dependency in the trial; runs only from the batch ingestion path, never from a request.
- **`ingest.py`** — batch job (`python -m app.services.coverage.ingest` or `POST /api/coverage/ingest`) that scans `coverage_exec_dropbox_dir` for `{JIRA_TEST_ID}_{app_repo}_{app_version}_{timestamp}.exec` files dropped by the QA Selenium harness, converts each via `jacoco_report.py`, and persists into the index. Processed files are renamed with a `.done` suffix for idempotency.
- **`tia_ranker.py`** — coverage-pipeline counterpart to `ranker.py`.

The capture side (attaching a JaCoCo TCP agent to the app-under-test, per-test reset/dump hooks in the Selenium harness) is QA/DevOps-owned infrastructure this repo does not control — this subpackage only does ingestion, indexing, diff-resolution, and lookup. As of the last update, capture-side infra was unconfirmed/in-progress (see the decision doc's Open Questions); treat `/api/tests/coverage-based` and `/api/coverage/compare` as returning empty/near-empty results until the index has been seeded.

### Component Mapping (`backend/config/repo_component_mapping.json`)

Maps Stash repo slug → `{ "Jira Component Name": ["sub-component-1", ...] }`. The sub-component strings are Jira sub-component values that drive the ranker's base weight. Updating this file is the primary way to tune which test areas get triggered by a given repo.

### Models (`app/models/schemas.py`)

- `Commit` — id, message, author, timestamp, repo, jira_tickets
- `TestCase` — jira_id, summary, component, sub_component, layer_found, impact_score, frequency (how many commits triggered it), ticket_priority_id (best priority among triggering tickets)
- `CoverageGap` — repo, commit_id, jira_tickets, reason (`no_jira_link` | `no_test_cases_found`)
- `RegressionEvent` — aggregates commits + recommended tests + gaps from one poll cycle
- `CommitTrace` — per-commit diagnostic with ticket→tag→slugs→components→sub_components resolution and a `status` field (`matched` | `no_ticket` | `no_component` | `no_permission`)
- `PipelineTraceResponse` — wraps a list of `CommitTrace` with scan-level counts
- `CommitScanResponse` — wraps commit list with repos_scanned, repos_with_changes, scan_from/to timestamps

`app/models/coverage_schemas.py` mirrors the shape of `schemas.py` for the coverage pipeline but stays independent of it (TIA results carry coverage-derived fields, not faked `sub_component`/`layer_found` values): `CoverageRun`, `ImpactedSymbol`, `CoverageTestCase`, `TIAComparisonResult`, `CoverageIndexStats`.

### JaCoCo Report Helper (`backend/tools/jacoco-report-helper/`)

Standalone Maven project (`mvn package` → `target/jacoco-report-helper.jar`). Not part of the Python dependency graph — invoked as a subprocess. See its own `README.md` for build/usage details.