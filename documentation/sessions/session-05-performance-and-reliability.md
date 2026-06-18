# Session 05 — Performance, Reliability & API Optimization

> Covers the diagnosis and fixes for the 500 error on the Recommended Tests tab, the root causes behind it, and the optimizations built to make the API faster and more resilient.

---

## 2026-06-18 — Fixing 500s, batching Jira, pagination

### Context

After Session 04 built the Recommended Tests tab, three problems surfaced in real usage:
1. The tab showed "API error 500" intermittently, making the feature unreliable
2. The initial pipeline load ("Run Pipeline") blocked users for 30–60s with a spinner
3. The Recommended Tests tab rendered 2943 rows at once, which was visually overwhelming and slow to paint

The 500s had multiple root causes that were discovered in layers — each fix revealing the next issue underneath.

### Decisions Made

- **Decision**: Add explicit error handling for `httpx.ConnectError` in the route layer — **Why**: When VPN is disconnected, the raw exception was propagating as a generic 500 with no message. A 503 with "Cannot reach Stash server. Check your VPN connection." is actionable; a 500 is not.

- **Decision**: Add retry-with-backoff on Jira 429 responses inside `_jql_search` — **Why**: With 194 unique tickets firing concurrent Jira queries, Jira rate-limits and returns 429. `raise_for_status()` on a 429 previously propagated as an unhandled exception. The fix respects the `Retry-After` header (falls back to incremental backoff) and retries up to 3 times before skipping.

- **Decision**: Add a `_SEARCH_SEMAPHORE` (max 3 concurrent) around test search queries — **Why**: Only ticket lookups had a concurrency limit before. Test searches (`search_tests_by_components`) had none, so all could fire simultaneously — exactly what triggers 429s. The semaphore applies back-pressure.

- **Decision**: Batch all component queries into a single JQL instead of one per component — **Why**: `component in ("Campaign", "Security")` is one Jira request. The prior loop fired one request per component. With 3–5 components per ticket set, this cuts Jira call volume by 3–5×. Fewer calls = lower 429 risk and faster response.

- **Decision**: Cache search results by component set (`_search_cache`) — **Why**: Many commits in a 7-day window map to the same component set (e.g. 57 commits all touching "Campaign"). Previously each commit's selector call re-queried Jira for the same tests. Cache key is `tuple(sorted(component_names))` — same components in any order hit the same cache entry.

- **Decision**: Frontend pagination at 20 rows with "Load more" — **Why**: The browser was painting 2943 table rows at once, causing layout thrashing. Rendering 20 rows immediately after the API responds feels instant; the remaining tests are already in memory and appear on click with zero additional API calls.

- **Decision**: Deferred persistent caching to a future decision — **Why**: The right production solution (scheduler writes results to a database, UI reads from the store) requires infrastructure alignment — database choice, deployment model. A real-world company project shouldn't make that choice without stakeholder input. The interim optimization (batching + in-memory cache) is enough for the POC.

### Logic & Approach

**Debugging the 500 in layers:**
The 500 had three independent causes that were discovered in sequence:
1. First suspected: VPN disconnected → `ConnectError` → unhandled 500. Confirmed by TLS handshake reset (`Connection reset by peer`). Fixed with 503 + clear message.
2. After VPN reconnected — still 500. Captured the actual exception by wrapping the route in a broad try/except and printing the traceback: `HTTPStatusError: 429 Too Many Requests`. The real culprit was Jira rate limiting, not connection issues.
3. After 429 fix — worked correctly. Root cause was that `search_tests_by_components` had no concurrency limit, so all component searches fired simultaneously into Jira.

The lesson: "Internal Server Error" tells you nothing. The fix for production is always: log the traceback, not just the status code.

**Why batch JQL is the biggest win:**
Each unique ticket in the pipeline calls `search_tests_by_components`. Before batching, 3 components = 3 Jira requests, each paginating through potentially hundreds of results. After batching, 3 components = 1 request. Combined with the search cache, subsequent calls for the same component set (which is the common case) are free. The combination effectively means Jira test searches are a one-time cost per unique component set per server lifetime, not per request.

**Why frontend pagination is complementary, not a substitute:**
Batching + caching makes the API faster. Pagination makes the browser faster. They solve different bottlenecks at different layers. The API could return in 5s but still feel slow if the browser has to paint 2943 rows synchronously. With 20-row pages, the user sees ranked results immediately and scrolls/loads more at their own pace.

### What Was Done

- Route-level error handling added for `ConnectError` (503) and `HTTPStatusError` (502) on both `/api/commits` and `/api/tests`
- Broad try/except temporarily added to `/api/tests` to surface the exact exception type — revealed the 429 root cause
- Retry-with-backoff loop added to `_jql_search` (3 attempts, respects `Retry-After` header)
- `_SEARCH_SEMAPHORE` (max 3 concurrent) added for test search calls
- `_JIRA_SEMAPHORE` reduced from 5 → 3 for ticket lookups
- `search_tests_by_components` rewritten to use batched `component in (...)` JQL instead of a per-component loop
- `_search_cache` added — keyed by sorted component tuple, persists for server lifetime
- `fetchTests` in `api.js` updated to extract the `detail` field from error JSON (shows meaningful message instead of generic "Service Unavailable")
- Frontend `RecommendedTestsView` paginated to 20 rows with "Load more — N remaining" button
- `useEffect` added to reset visible count when new test data loads

### Tradeoffs

| Decision | What we gave up / Risk |
|---|---|
| In-memory search cache with no TTL | Cache never expires — if a Jira component's test suite changes mid-day, the server will serve stale results until restart. Acceptable for POC; production needs a TTL or explicit invalidation. |
| Frontend-only pagination (data fully loaded first) | The spinner still runs for the full API duration before showing anything. True progressive loading (streaming) would show results as they arrive, but requires SSE or WebSockets — significant complexity. |
| Deferred persistent caching | Users still see a 30–60s spinner on first run after backend restart. This is the biggest UX pain point and the right fix (DB-backed scheduler store) is pending manager approval. |
| Semaphore at 3 | More conservative than before (was 5). Slower throughput but much lower 429 risk. Can be tuned up if Jira's rate limits allow. |

### Relationships

- The `_search_cache` only works because `select_tests_for_commits` in [[session-04-recommended-tests-and-scoring]] deduplicates by ticket ID before firing selectors — without that dedup, the same cache key would still get multiple parallel misses on first access
- The 429 problem is inherently tied to the scale of the data (849 commits, 194 tickets) discovered in [[session-01-orientation-and-planning]] — this wouldn't have been an issue at 10 commits
- The persistent caching decision is now an open architectural question that sits between this session and whatever Phase 3 infrastructure work gets approved

### Open Questions

- **Persistent result store**: Should the scheduler write pipeline results to SQLite or PostgreSQL? What's the retention policy (keep last N runs, or by date)? Pending manager alignment.
- **Cache TTL**: The `_search_cache` has no expiry. Should it be time-bounded (e.g., 4 hours)? Or is a server restart sufficient as a cache flush for the POC?
- **Semaphore tuning**: Is `_JIRA_SEMAPHORE=3` and `_SEARCH_SEMAPHORE=3` the right balance? Needs observing in practice — if 429s still appear, lower; if performance is acceptable, could try 4.
- **True progressive loading**: If the manager approves a DB-backed store, the "Run Pipeline" flow changes entirely (reads from store, instant). At that point, frontend pagination becomes less critical but still useful for rendering performance.
