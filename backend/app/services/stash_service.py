import asyncio
import logging
from datetime import datetime
from typing import List, Optional

import httpx

from app.config import settings
from app.models.stash_models import RepoActivity
from app.utils.date_utils import format_date, to_epoch_ms

logger = logging.getLogger(__name__)

STASH_API_BASE = f"{settings.stash_base_url}/rest/api/1.0"
AUTH_HEADERS = {"Authorization": f"Bearer {settings.stash_token}"}


async def fetch_all_repos(client: httpx.AsyncClient) -> List[dict]:
    """Fetches all repos under the configured Stash project, handling pagination."""
    repos = []
    start = 0
    limit = settings.stash_page_limit

    while True:
        url = (
            f"{STASH_API_BASE}/projects/{settings.stash_project_key}/repos"
            f"?limit={limit}&start={start}"
        )
        response = await client.get(url, headers=AUTH_HEADERS)
        response.raise_for_status()
        data = response.json()

        repos.extend(data.get("values", []))

        if data.get("isLastPage", True):
            break
        start = data.get("nextPageStart", start + limit)

    return repos


async def fetch_commits_in_range(
    client: httpx.AsyncClient,
    repo_slug: str,
    since_epoch_ms: int,
    until_epoch_ms: int,
) -> List[dict]:
    """
    Fetches commits for a single repo within [since, until].
    Handles pagination. Returns all matching commit objects.
    """
    commits = []
    start = 0
    limit = settings.stash_page_limit

    while True:
        url = (
            f"{STASH_API_BASE}/projects/{settings.stash_project_key}"
            f"/repos/{repo_slug}/commits"
            f"?limit={limit}&start={start}"
            f"&since={since_epoch_ms}&until={until_epoch_ms}"
        )
        try:
            response = await client.get(url, headers=AUTH_HEADERS)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Failed to fetch commits for repo '%s': %s", repo_slug, exc.response.status_code
            )
            return []
        except httpx.RequestError as exc:
            logger.warning("Request error for repo '%s': %s", repo_slug, exc)
            return []

        commits.extend(data.get("values", []))

        if data.get("isLastPage", True):
            break
        start = data.get("nextPageStart", start + limit)

    return commits


def _build_repo_url(repo_slug: str) -> str:
    return (
        f"{settings.stash_base_url}/projects/{settings.stash_project_key}"
        f"/repos/{repo_slug}/browse"
    )


def _extract_commit_date(commit: dict) -> Optional[str]:
    ts = commit.get("authorTimestamp") or commit.get("committerTimestamp")
    if ts:
        return format_date(datetime.utcfromtimestamp(ts / 1000))
    return None


async def get_active_repos(from_dt: datetime, to_dt: datetime) -> tuple[List[RepoActivity], int]:
    """
    Scans all repos in the CM project and returns those with commits
    in the given date range, sorted by last_commit_date descending.
    """
    since_ms = to_epoch_ms(from_dt)
    until_ms = to_epoch_ms(to_dt)

    timeout = httpx.Timeout(30.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        repos = await fetch_all_repos(client)

        async def process_repo(repo: dict) -> Optional[RepoActivity]:
            slug = repo.get("slug", "")
            name = repo.get("name", slug)

            commits = await fetch_commits_in_range(client, slug, since_ms, until_ms)
            if not commits:
                return None

            authors = sorted(
                {
                    c.get("author", {}).get("slug")
                    or c.get("author", {}).get("name", "unknown")
                    for c in commits
                }
            )
            dates = [_extract_commit_date(c) for c in commits if _extract_commit_date(c)]
            last_commit_date = max(dates) if dates else "unknown"

            return RepoActivity(
                name=name,
                slug=slug,
                commit_count=len(commits),
                last_commit_date=last_commit_date,
                authors=authors,
                repo_url=_build_repo_url(slug),
            )

        # Run all repo queries concurrently, capped to avoid overwhelming the API
        semaphore = asyncio.Semaphore(10)

        async def throttled_process(repo: dict) -> Optional[RepoActivity]:
            async with semaphore:
                return await process_repo(repo)

        results = await asyncio.gather(*[throttled_process(r) for r in repos])

    active = [r for r in results if r is not None]
    active.sort(key=lambda r: r.last_commit_date, reverse=True)
    return active, len(repos)
