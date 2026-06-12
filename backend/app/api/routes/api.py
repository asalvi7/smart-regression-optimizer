from fastapi import APIRouter, Query
from datetime import datetime, timezone, timedelta
import asyncio

from app.services.stash_service import get_repos_with_recent_commits, get_all_repos
from app.services.selector import select_tests_for_commits
from app.services.ranker import rank_tests
from app.models.schemas import CommitScanResponse, TestCase, CoverageGap
from app.core.scheduler import event_store, run_poll

router = APIRouter()


@router.get("/commits", response_model=CommitScanResponse)
async def get_commits(
    since_days: int = Query(default=7, ge=1, le=90),
    limit: int = Query(default=100, ge=1, le=500),
):
    all_repos, repo_commits = await asyncio.gather(
        get_all_repos(),
        get_repos_with_recent_commits(since_days=since_days),
    )
    all_commits = [c for commits in repo_commits.values() for c in commits]

    # Truncate message so the response stays small
    for c in all_commits:
        c.message = c.message[:120].split("\n")[0]

    now = datetime.now(tz=timezone.utc)
    return CommitScanResponse(
        repos_scanned=len(all_repos),
        repos_with_changes=len(repo_commits),
        commits=all_commits[:limit],
        scan_from=now - timedelta(days=since_days),
        scan_to=now,
    )


@router.get("/tests")
async def get_test_recommendations(since_days: int = Query(default=7, ge=1, le=90)):
    repo_commits = await get_repos_with_recent_commits(since_days=since_days)
    all_commits = [c for commits in repo_commits.values() for c in commits]

    selected, gaps = await select_tests_for_commits(all_commits)
    ranked = rank_tests(selected, all_commits)

    return {
        "total_tests": len(ranked),
        "coverage_gaps": len(gaps),
        "tests": ranked,
        "gaps": gaps,
    }


@router.get("/events")
async def get_events(limit: int = Query(default=20, ge=1, le=100)):
    return {"events": event_store[:limit], "total": len(event_store)}


@router.post("/events/trigger")
async def trigger_poll():
    await run_poll()
    return {"status": "ok", "events_stored": len(event_store)}
