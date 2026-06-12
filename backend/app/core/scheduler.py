from apscheduler.schedulers.asyncio import AsyncIOScheduler
from datetime import datetime, timezone
import uuid

from app.core.config import get_settings
from app.services.stash_service import get_repos_with_recent_commits
from app.services.selector import select_tests_for_commits
from app.services.ranker import rank_tests
from app.models.schemas import RegressionEvent

settings = get_settings()

event_store: list[RegressionEvent] = []
_last_seen: dict[str, str] = {}


async def run_poll():
    print(f"[poller] Starting scan at {datetime.now(tz=timezone.utc).isoformat()}")

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
    ranked_tests = rank_tests(selected_tests, new_commits)

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
    )
    return scheduler
