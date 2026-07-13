from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timezone, timedelta
import asyncio
import httpx

from app.services.stash_service import get_repos_with_recent_commits, get_all_repos, get_commit_files, get_commit_diff
from app.services.selector import select_tests_for_commits
from app.services.ranker import rank_tests
from app.services.trace_service import build_pipeline_trace
from app.models.schemas import CommitScanResponse, TestCase, CoverageGap, PipelineTraceResponse
from app.core.scheduler import event_store, run_poll

router = APIRouter()


@router.get("/commits", response_model=CommitScanResponse)
async def get_commits(
    since_days: int = Query(default=7, ge=1, le=90),
    limit: int = Query(default=100, ge=1, le=500),
):
    try:
        all_repos, repo_commits = await asyncio.gather(
            get_all_repos(),
            get_repos_with_recent_commits(since_days=since_days),
        )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Cannot reach Stash server. Check your VPN connection.")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Stash returned HTTP {exc.response.status_code}.")
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
    import traceback
    try:
        repo_commits = await get_repos_with_recent_commits(since_days=since_days)
        all_commits = [c for commits in repo_commits.values() for c in commits]
        selected, gaps = await select_tests_for_commits(all_commits)
        ranked = rank_tests(selected)
        return {
            "total_tests": len(ranked),
            "coverage_gaps": len(gaps),
            "tests": ranked,
            "gaps": gaps,
        }
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[/api/tests ERROR]\n{tb}")
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")


@router.get("/debug/ticket/{ticket_id}")
async def debug_ticket(ticket_id: str):
    """Return all raw Jira fields for a ticket — used to discover custom field IDs."""
    import httpx, base64
    from app.core.config import get_settings
    s = get_settings()
    token = base64.b64encode(f"{s.jira_email}:{s.jira_token}".encode()).decode()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{s.jira_base_url}/rest/api/3/issue/{ticket_id}",
            headers={"Authorization": f"Basic {token}", "Content-Type": "application/json"},
        )
    if resp.status_code != 200:
        return {
            "error": f"Jira returned HTTP {resp.status_code}",
            "ticket": ticket_id,
            "url": f"{s.jira_base_url}/rest/api/3/issue/{ticket_id}",
            "jira_response": resp.text[:500],
        }
    data = resp.json()
    fields = data.get("fields", {})
    # Return only non-null fields to keep it readable
    return {
        "status": "ok",
        "ticket": ticket_id,
        "non_null_fields": {k: v for k, v in fields.items() if v is not None and v != [] and v != {}},
    }


@router.get("/trace", response_model=PipelineTraceResponse)
async def get_pipeline_trace(since_days: int = Query(default=7, ge=1, le=90)):
    return await build_pipeline_trace(since_days=since_days)


@router.get("/commits/{repo}/{commit_id}/files")
async def get_files_for_commit(repo: str, commit_id: str):
    """Return the list of files changed in a specific commit."""
    if len(commit_id) < 20:
        return {
            "error": "short_sha",
            "detail": f"commit_id '{commit_id}' is a short SHA — restart backend and re-run pipeline",
            "files": [],
        }
    files, debug = await get_commit_files(repo, commit_id)
    return {"files": files, "repo": repo, "commit_id": commit_id, "debug": debug}


@router.get("/commits/{repo}/{commit_id}/diff")
async def get_diff_for_file(repo: str, commit_id: str, path: str = Query(...)):
    """Return the parsed diff for one file in a commit."""
    return await get_commit_diff(repo, commit_id, path)


@router.get("/events")
async def get_events(limit: int = Query(default=20, ge=1, le=100)):
    return {"events": event_store[:limit], "total": len(event_store)}


@router.post("/events/trigger")
async def trigger_poll():
    await run_poll()
    return {"status": "ok", "events_stored": len(event_store)}
