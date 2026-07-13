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

_REPO_ALLOWLIST = {s.strip() for s in settings.stash_repo_allowlist.split(",") if s.strip()} or None


async def get_all_repos() -> list[dict]:
    """
    List repos in stash_project_key, filtered to STASH_REPO_ALLOWLIST if set
    (see app/core/config.py). All downstream scanning (get_repos_with_recent_commits,
    the /api/trace repos_scanned count) goes through this, so setting the
    allowlist scopes the whole pipeline to just those repos.
    """
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

    if _REPO_ALLOWLIST is not None:
        repos = [r for r in repos if r["slug"] in _REPO_ALLOWLIST]

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


def _parse_changes(data: dict) -> list[dict]:
    return [
        {"path": item["path"]["toString"], "type": item.get("type", "MODIFY")}
        for item in data.get("values", [])
        if item.get("nodeType") == "FILE" and item.get("path", {}).get("toString")
    ]


async def _fetch_commit_meta(client: httpx.AsyncClient, repo_slug: str, commit_id: str) -> dict:
    """Fetch raw commit metadata (parents, message) from Stash."""
    url = (
        f"{_BASE}/rest/api/1.0/projects/{settings.stash_project_key}"
        f"/repos/{repo_slug}/commits/{commit_id}"
    )
    resp = await client.get(url, headers=STASH_HEADERS)
    if resp.status_code != 200:
        return {}
    return resp.json()


async def get_commit_files(repo_slug: str, commit_id: str) -> tuple[list[dict], str]:
    """
    Return (files, debug_info) for a commit.
    Handles merge commits by falling back to comparing against the first parent explicitly.
    """
    base_url = (
        f"{_BASE}/rest/api/1.0/projects/{settings.stash_project_key}"
        f"/repos/{repo_slug}/commits/{commit_id}"
    )
    changes_url = f"{base_url}/changes?limit=100"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(changes_url, headers=STASH_HEADERS)
        status = resp.status_code
        print(f"[files] GET {changes_url} → {status}")

        if status in (400, 404, 500):
            return [], f"Stash returned HTTP {status} for commit {commit_id[:12]}"

        resp.raise_for_status()
        data = resp.json()
        files = _parse_changes(data)

        # If no files returned, check if this is a merge commit and retry with explicit since
        if not files:
            meta = await _fetch_commit_meta(client, repo_slug, commit_id)
            parents = meta.get("parents", [])
            print(f"[files] empty result — parents: {[p.get('id','')[:12] for p in parents]}")

            if len(parents) >= 1:
                # Try explicit since= first parent
                first_parent = parents[0]["id"]
                retry_url = f"{base_url}/changes?since={first_parent}&limit=100"
                resp2 = await client.get(retry_url, headers=STASH_HEADERS)
                print(f"[files] retry GET {retry_url} → {resp2.status_code}")
                if resp2.status_code == 200:
                    files = _parse_changes(resp2.json())

    return files, ""


def _parse_diff_response(data: dict) -> list[dict]:
    """Extract hunks from a Stash diff API response."""
    diffs = data.get("diffs", [])
    if not diffs:
        return []
    hunks = []
    for hunk in diffs[0].get("hunks", []):
        lines = []
        for segment in hunk.get("segments", []):
            seg_type = segment["type"]  # CONTEXT | ADDED | REMOVED
            for ln in segment.get("lines", []):
                lines.append({
                    "type": seg_type,
                    "src": ln.get("source", 0),
                    "dst": ln.get("destination", 0),
                    "text": ln.get("line", ""),
                })
        hunks.append({
            "src_line": hunk.get("sourceLine", 0),
            "dst_line": hunk.get("destinationLine", 0),
            "lines": lines,
        })
    return hunks


async def get_commit_diff(repo_slug: str, commit_id: str, file_path: str) -> dict:
    """Return parsed diff for one file in a commit.
    Tries multiple URL forms in order; logs the Stash error body on failure.
    slashes must stay unencoded (safe="/") — Stash returns 404 otherwise.
    withComments param causes 400 on Stash Server — never include it.
    """
    from urllib.parse import quote
    encoded = quote(file_path, safe="/")
    stash_url = (
        f"{_BASE}/projects/{settings.stash_project_key}"
        f"/repos/{repo_slug}/commits/{commit_id}#{file_path}"
    )
    diff_base = (
        f"{_BASE}/rest/api/1.0/projects/{settings.stash_project_key}"
        f"/repos/{repo_slug}/diff/{encoded}"
    )

    async with httpx.AsyncClient(timeout=30) as client:
        meta = await _fetch_commit_meta(client, repo_slug, commit_id)
        parents = meta.get("parents", [])
        first_parent = parents[0]["id"] if parents else None
        is_merge = len(parents) >= 2

        # This Stash Server requires "until" (not "at") as the commit parameter
        candidates = [f"{diff_base}?until={commit_id}"]
        if first_parent:
            candidates.insert(0, f"{diff_base}?until={commit_id}&since={first_parent}")

        resp = None
        for url in candidates:
            resp = await client.get(url, headers=STASH_HEADERS)
            print(f"[diff] {url[-100:]} → {resp.status_code}")
            if resp.status_code == 200:
                break
            print(f"[diff] body: {resp.text[:300]}")

        if resp is None or resp.status_code != 200:
            status = resp.status_code if resp else "no-response"
            return {"hunks": [], "truncated": False, "stash_url": stash_url,
                    "error": f"Stash returned HTTP {status}"}

        data = resp.json()
        hunks = _parse_diff_response(data)
        truncated = (data.get("diffs") or [{}])[0].get("truncated", False)

    total_lines = sum(len(h["lines"]) for h in hunks)
    return {
        "hunks": hunks,
        "truncated": truncated or total_lines > 3000,
        "stash_url": stash_url,
    }


async def get_file_content_at_commit(repo_slug: str, commit_id: str, file_path: str) -> str:
    """Fetch a file's full raw content at a given commit revision.

    Used by the coverage/diff_parser.py trial pipeline to resolve changed line
    numbers to enclosing Java methods/classes — the existing get_commit_diff()
    only returns line-level hunks, not full file content, so this is additive
    rather than a replacement for anything the component-mapping pipeline uses.
    """
    from urllib.parse import quote
    encoded = quote(file_path, safe="/")
    url = (
        f"{_BASE}/rest/api/1.0/projects/{settings.stash_project_key}"
        f"/repos/{repo_slug}/raw/{encoded}?at={commit_id}"
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=STASH_HEADERS)
        if resp.status_code != 200:
            return ""
        return resp.text


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
