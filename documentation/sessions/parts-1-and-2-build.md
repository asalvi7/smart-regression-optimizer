# Parts 1 & 2 — Core Backend Build

> Covers the two completed build sessions: Stash commit scanning and Jira test selection + ranking.

---

## 2026-06-12 — Stash scanner, selector, and ranker built

### Context
Mediaocean's CM team runs a large Jira/Stash-based test suite. After every code change, the full regression suite runs — which is slow and wasteful given there are 40–80+ repos and hundreds of Jira test cases. The goal of this POC was to answer: *can we look at what changed and intelligently select only the tests that matter?*

### Decisions Made

- **Use Stash as the commit source, not webhooks** — Why: simpler for a POC; polling is predictable and doesn't require inbound network configuration on the Stash side. A webhook approach would be faster in production but adds setup complexity.

- **Extract Jira ticket IDs from commit messages via regex** — Why: the team already embeds `ADINFRA-*` and `IAPP-*` IDs in commit messages by convention. No new tooling needed to link code to tickets.

- **Use the Jira Tag custom field (`customfield_10313`) as primary routing signal** — Why: the Tag field often contains the repo slug directly (e.g. `campaign-management:2026.5.80`), making the mapping from commit → component deterministic. The component mapping JSON is a fallback for when the tag is absent.

- **`repo_component_mapping.json` as static config, not derived** — Why: Jira has no native repo→component relationship. We manually curated this mapping. Keeping it as a checked-in JSON file makes it auditable and easy to update without code changes. Deriving it automatically at scale is a future improvement.

- **Two-layer test discovery** — Layer 1 (ticket link traversal) and Layer 2 (component JQL search). Layer 1 is more precise (follows "Relates" issue links to IAPP suites) but was left as a secondary path. Layer 2 (component search) is the active path because it's more reliable across the ticket landscape in this Jira project.

- **Deduplication before Jira calls** — commits referencing the same ticket would otherwise trigger redundant Jira fetches. Deduplication happens at the selector level before any async requests fire.

- **No database** — for a POC, in-memory storage for the scheduler's event history is acceptable. Acknowledged tradeoff: history is lost on restart. This is intentional — if this goes to production, persistence would be needed.

- **`asyncio.Semaphore(5)` on Jira requests** — Jira rate-limits aggressively. Unlimited concurrency would get the service blocked. 5 was chosen empirically as a safe ceiling without meaningfully slowing down the pipeline.

### Logic & Approach

The core mental model is a two-stage pipeline: *what changed* → *what should we test*.

Stage 1 (Stash): Given a time window, scan all CM repos concurrently, extract commit metadata, and parse ticket IDs from messages.

Stage 2 (Jira): For each unique commit, try to route it to a Jira component. If the commit has a ticket, use the ticket's Tag field to find the repo slug, then map that slug to components. If no ticket (or the tag is empty), use the commit's own repo slug as the lookup key. Then JQL-query for Selenium test cases in those components.

Ranking is additive: start with a base weight per sub-component category (CM-heavy areas score higher than reporting areas), then add small bonuses for direct ticket links and commit-overlap signals. It's a simple scoring model, not ML — intentional for a POC where interpretability matters.

Coverage Gaps are first-class outputs, not just missing data. When a commit can't be mapped to tests, we record *why* (`no_jira_link` or `no_test_cases_found`) so the team can see which repos/areas lack test coverage.

### What Was Done

- `stash_service.py`: concurrent repo + commit fetcher with pagination and graceful 404/500 handling
- `jira_service.py`: tag-field lookup, component JQL search, in-run caching, semaphore-limited async fetching
- `selector.py`: commit-to-test routing logic with tag-first / repo-fallback paths and deduplication
- `ranker.py`: additive impact score (0–1.0) and sorted output
- `scheduler.py`: APScheduler background poller tracking last-seen commits per repo
- `schemas.py`: Pydantic v2 models for all domain objects
- `repo_component_mapping.json`: initial repo→component mapping for CM project
- 4 API endpoints wired up in FastAPI

### Tradeoffs

| Decision | What we gave up |
|----------|----------------|
| Polling instead of webhooks | Latency — changes detected up to 15 min late |
| In-memory event store | Persistence across restarts |
| Static component mapping | Needs manual updates when team structure changes |
| Layer 2 only (component search) | Precision — Layer 1 traversal could be more targeted but is fragile |
| No ML ranking | Adaptability — scores don't improve from feedback without manual tuning |

### Relationships

- The Selenium filter JQL (`cf[11133]`, `cf[10158]`, `cf[10159]`) is Mediaocean-specific — it encodes which Jira custom fields mark a test as automated and runnable. This is not generic.
- `repo_component_mapping.json` is the primary tuning lever for precision. Almost all false positives/negatives in test selection trace back to this file.
- The ranker's base weights (`CM-` = 1.0, `REP-` = 0.4, etc.) were set by judgment, not data. They should be validated against actual bug catch rates if this moves to production.

### Open Questions

- **Part 3 scope**: ReportPortal integration, React frontend, or feedback loop — not yet decided. The backend is ready to serve all three.
- **Frontend**: The Vite scaffold was removed during Part 1 refactoring. Component stubs exist but are empty. Needs a rebuild decision before any UI work starts.
- **Layer 1 traversal**: Left implemented but unused. Worth revisiting if Layer 2 results prove too noisy.
- **Scaling the component mapping**: As CM repos grow, manual curation becomes a bottleneck. Could be auto-derived from the Tag field at scale across historical tickets.
