from apscheduler.schedulers.asyncio import AsyncIOScheduler
from datetime import datetime, timezone
import uuid

from app.core.config import get_settings
from app.services.stash_service import get_repos_with_recent_commits
from app.services.selector import select_tests_for_commits
from app.services.ranker import rank_tests
from app.services.trace_service import build_pipeline_trace
from app.models.schemas import RegressionEvent, PipelineTraceResponse

settings = get_settings()

event_store: list[RegressionEvent] = []
_last_seen: dict[str, str] = {}

# Cache of the last-computed pipeline trace at the dashboard's default window,
# kept warm by the poller so the frontend can render instantly on load instead
# of paying for a live Stash+Jira scan on every page open. See
# documentation/decisions/ for the reasoning (dashboard cold-start caching).
TRACE_CACHE_DEFAULT_DAYS = 7
cached_trace: PipelineTraceResponse | None = None
cached_trace_at: datetime | None = None


async def refresh_trace_cache():
    global cached_trace, cached_trace_at
    try:
        cached_trace = await build_pipeline_trace(since_days=TRACE_CACHE_DEFAULT_DAYS)
        cached_trace_at = datetime.now(tz=timezone.utc)
        print(f"[poller] Trace cache refreshed: {cached_trace.commits_processed} commits")
    except Exception as exc:
        print(f"[poller] Trace cache refresh failed (keeping previous cache): {exc}")


async def run_poll():
    print(f"[poller] Starting scan at {datetime.now(tz=timezone.utc).isoformat()}")

    await refresh_trace_cache()

    repo_commits = await get_repos_with_recent_commits(since_days=settings.commit_lookback_days)

    new_commits = []
    repos_changed = []

    for repo_slug, commits in repo_commits.items():
        last = _last_seen.get(repo_slug)
        fresh = [c for c in commits if c.id != last] if last else commits
        if fresh:
            new_commits.extend(fresh)
            repos_changed.append(repo_slug)
            _last_seen[repo_slug] = commits[0].id

    if not new_commits:
        print("[poller] No new commits found.")
        return

    print(f"[poller] Found {len(new_commits)} new commits across {len(repos_changed)} repos")

    selected_tests, gaps = await select_tests_for_commits(new_commits)
    ranked_tests = rank_tests(selected_tests)

    event = RegressionEvent(
        id=str(uuid.uuid4()),
        detected_at=datetime.now(tz=timezone.utc),
        repos_changed=repos_changed,
        commits=new_commits,
        recommended_tests=ranked_tests,
        coverage_gaps=gaps,
        total_tests_saved=0,
    )
    event_store.insert(0, event)

    print(f"[poller] Event created: {len(ranked_tests)} tests recommended, {len(gaps)} gaps flagged")


def create_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        run_poll,
        trigger="interval",
        minutes=settings.poll_interval_minutes,
        id="stash_poller",
        replace_existing=True,
        next_run_time=datetime.now(tz=timezone.utc),  # run immediately on startup, not just after the first interval
    )
    return scheduler
