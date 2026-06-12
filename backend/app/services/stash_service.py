import httpx
import re
from datetime import datetime, timezone, timedelta
from app.core.config import get_settings
from app.models.schemas import Commit

settings = get_settings()

_BASE = settings.stash_base_url.rstrip("/")

TICKET_PATTERN = re.compile(r'\b(?:ADINFRA|IAPP)-\d+\b', re.IGNORECASE)

STASH_HEADERS = {
    "Authorization": f"Bearer {settings.stash_token}",
    "Content-Type": "application/json",
}


async def get_all_repos() -> list[dict]:
    repos = []
    start = 0
    limit = 100

    async with httpx.AsyncClient(timeout=60) as client:
        while True:
            url = (
                f"{_BASE}/rest/api/1.0/projects"
                f"/{settings.stash_project_key}/repos"
                f"?limit={limit}&start={start}"
            )
            resp = await client.get(url, headers=STASH_HEADERS)
            resp.raise_for_status()
            data = resp.json()
            repos.extend(data.get("values", []))
            if data.get("isLastPage", True):
                break
            start += limit

    return repos


async def get_commits_since(repo_slug: str, since: datetime) -> list[Commit]:
    commits = []
    start = 0
    limit = 100
    since_ts = int(since.timestamp() * 1000)

    async with httpx.AsyncClient(timeout=60) as client:
        while True:
            url = (
                f"{_BASE}/rest/api/1.0/projects"
                f"/{settings.stash_project_key}/repos/{repo_slug}"
                f"/commits?limit={limit}&start={start}&until=refs/heads/master"
            )
            resp = await client.get(url, headers=STASH_HEADERS)
            if resp.status_code in (404, 500):
                return []
            resp.raise_for_status()
            data = resp.json()

            for c in data.get("values", []):
                commit_ts = c.get("authorTimestamp", 0)
                if commit_ts < since_ts:
                    return commits
                message = c.get("message", "")
                if message.startswith("[jenkins-release]"):
                    continue
                tickets = TICKET_PATTERN.findall(message)
                commits.append(Commit(
                    id=c["id"],
                    message=message,
                    author=c.get("author", {}).get("displayName", "unknown"),
                    timestamp=datetime.fromtimestamp(commit_ts / 1000, tz=timezone.utc),
                    repo=repo_slug,
                    jira_tickets=list(set(t.upper() for t in tickets)),
                ))

            if data.get("isLastPage", True):
                break
            start += limit

    return commits


async def get_repos_with_recent_commits(since_days: int = 30) -> dict[str, list[Commit]]:
    since = datetime.now(tz=timezone.utc) - timedelta(days=since_days)
    repos = await get_all_repos()

    result = {}
    import asyncio
    semaphore = asyncio.Semaphore(10)  # max 10 concurrent requests to Stash

    async def fetch_one(repo):
        async with semaphore:
            slug = repo["slug"]
            commits = await get_commits_since(slug, since)
            if commits:
                result[slug] = commits

    await asyncio.gather(*[fetch_one(r) for r in repos])
    return result
