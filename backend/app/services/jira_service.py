import httpx
import base64
import asyncio
from app.core.config import get_settings
from app.models.schemas import TestCase

settings = get_settings()

_token = base64.b64encode(
    f"{settings.jira_email}:{settings.jira_token}".encode()
).decode()

JIRA_HEADERS = {
    "Authorization": f"Basic {_token}",
    "Content-Type": "application/json",
}

# cf[11133]=Automation Tool (migrated), cf[10158]=Automation Tool (old), cf[10159]=Automated
# Matches both migrated ADINFRA test cases and old IAPP test cases
SELENIUM_FILTER = (
    '(cf[11133] in ("Selenium", EMPTY) OR cf[10158] in ("Selenium", EMPTY))'
    ' AND cf[10159] = "Yes"'
    ' AND (labels not in (API, CrossMedia_LTV, CrossMedia_NTV, CrossMedia_Radio,'
    ' LocalTV, NationalTV, Converged, TV_Mediaplan) OR labels is EMPTY)'
)

# Max concurrent requests to Jira to avoid 429 rate limiting
_JIRA_SEMAPHORE = asyncio.Semaphore(5)

# Cache tag lookups so the same ticket is never fetched twice in one run
_tag_cache: dict[str, list[str]] = {}
_tag_text_cache: dict[str, str] = {}  # raw tag text for display in trace


async def _jql_search(jql: str, fields: list[str]) -> list[dict]:
    issues = []
    next_page_token = None
    max_results = 100

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            payload = {
                "jql": jql,
                "maxResults": max_results,
                "fields": fields,
                "fieldsByKeys": False,
            }
            if next_page_token:
                payload["nextPageToken"] = next_page_token

            resp = await client.post(
                f"{settings.jira_base_url}/rest/api/3/search/jql",
                headers=JIRA_HEADERS,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            issues.extend(data.get("issues", []))
            next_page_token = data.get("nextPageToken")
            if not next_page_token or data.get("isLast", True):
                break

    return issues


def _extract_tag_text(customfield_10313) -> str:
    """Pull plain text out of the Tag field — handles both plain string and ADF document."""
    if not customfield_10313:
        return ""
    if isinstance(customfield_10313, str):
        return customfield_10313.strip()
    try:
        texts = []
        for block in customfield_10313.get("content", []):
            for inline in block.get("content", []):
                if inline.get("type") == "text":
                    texts.append(inline["text"])
        return ", ".join(texts)
    except Exception:
        return ""


def extract_repo_slugs_from_tag(tag_text: str) -> list[str]:
    """
    Tag examples:
      'campaign-management/2026.5.110'
      'prisma-locale-bundle:2026.5.6, campaign-management:2026.5.80'
    Returns the repo slug prefix(es): ['campaign-management', 'prisma-locale-bundle']
    """
    import re
    slugs = []
    for part in re.split(r'[,;]', tag_text):
        part = part.strip()
        match = re.match(r'^([a-z0-9\-]+)[:/]', part)
        if match:
            slugs.append(match.group(1))
    return slugs


async def get_tag_repos_for_ticket(ticket_id: str) -> list[str]:
    """
    A1: Fetch an ADINFRA ticket from Jira and return the repo slug(s)
    extracted from its Tag field (customfield_10313).
    Uses an in-memory cache and semaphore to avoid 429 rate limiting.
    """
    if ticket_id in _tag_cache:
        return _tag_cache[ticket_id]

    async with _JIRA_SEMAPHORE:
        # Double-check cache after acquiring semaphore (another coroutine may have fetched it)
        if ticket_id in _tag_cache:
            return _tag_cache[ticket_id]

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{settings.jira_base_url}/rest/api/3/issue/{ticket_id}"
                "?fields=customfield_10313",
                headers=JIRA_HEADERS,
            )
            if resp.status_code in (404, 400):
                _tag_cache[ticket_id] = []
                return []
            resp.raise_for_status()
            fields = resp.json().get("fields", {})

    tag_text = _extract_tag_text(fields.get("customfield_10313"))
    _tag_text_cache[ticket_id] = tag_text
    result = extract_repo_slugs_from_tag(tag_text)
    _tag_cache[ticket_id] = result
    return result


def get_cached_tag_text(ticket_id: str) -> str:
    return _tag_text_cache.get(ticket_id, "")


_ticket_details_cache: dict[str, dict] = {}


async def get_ticket_details(ticket_id: str) -> dict:
    """
    Fetch a feature ticket and return tag, repo slugs, and components.
    Components are read directly from the ticket's `components` field — no mapping JSON.
    Returns: {tag: str, slugs: list[str], components: list[str]}
    """
    if ticket_id in _ticket_details_cache:
        return _ticket_details_cache[ticket_id]

    async with _JIRA_SEMAPHORE:
        if ticket_id in _ticket_details_cache:
            return _ticket_details_cache[ticket_id]

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{settings.jira_base_url}/rest/api/3/issue/{ticket_id}"
                "?fields=customfield_10313,priority",
                headers=JIRA_HEADERS,
            )
            if resp.status_code == 401:
                result = {"tag": "", "slugs": [], "components": [], "sub_components": [], "priority_id": "4", "error": "auth_failed"}
                _ticket_details_cache[ticket_id] = result
                return result
            if resp.status_code in (403, 404):
                result = {"tag": "", "slugs": [], "components": [], "sub_components": [], "priority_id": "4", "error": "no_permission"}
                _ticket_details_cache[ticket_id] = result
                _tag_text_cache[ticket_id] = ""
                _tag_cache[ticket_id] = []
                return result
            resp.raise_for_status()
            fields = resp.json().get("fields", {})

    tag_text = _extract_tag_text(fields.get("customfield_10313"))
    slugs = extract_repo_slugs_from_tag(tag_text)
    components = slugs
    sub_components = []
    priority_id = str(fields.get("priority", {}).get("id", "4"))  # "1"=Highest … "5"=Lowest

    result = {"tag": tag_text, "slugs": slugs, "components": components, "sub_components": sub_components, "priority_id": priority_id, "error": None}
    _ticket_details_cache[ticket_id] = result
    _tag_text_cache[ticket_id] = tag_text
    _tag_cache[ticket_id] = slugs
    return result


async def search_tests_by_components(component_names: list[str]) -> list[TestCase]:
    """Search test cases using component names taken directly from a Jira feature ticket."""
    if not component_names:
        return []

    test_cases = []
    for component in component_names:
        jql = f'component = "{component}" AND {SELENIUM_FILTER}'
        issues = await _jql_search(jql, ["summary", "components", "customfield_10100"])
        for issue in issues:
            fields = issue.get("fields", {})
            sub_comp = fields.get("customfield_10100")
            sub_component = sub_comp.get("value", "") if sub_comp else ""
            test_cases.append(TestCase(
                jira_id=issue["key"],
                summary=fields.get("summary", ""),
                component=component,
                sub_component=sub_component,
                layer_found=2,
                impact_score=0.0,
            ))

    seen: set[str] = set()
    unique = []
    for tc in test_cases:
        if tc.jira_id not in seen:
            seen.add(tc.jira_id)
            unique.append(tc)
    return unique


async def layer1_traverse(ticket_id: str) -> list[TestCase]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{settings.jira_base_url}/rest/api/3/issue/{ticket_id}"
            "?fields=issuelinks",
            headers=JIRA_HEADERS,
        )
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        issue_data = resp.json()

    suite_ids = []
    for link in issue_data.get("fields", {}).get("issuelinks", []):
        linked = link.get("outwardIssue") or link.get("inwardIssue")
        if linked and link.get("type", {}).get("name") == "Relates":
            key = linked.get("key", "")
            if key.startswith("IAPP-"):
                suite_ids.append(key)

    if not suite_ids:
        return []

    test_cases = []
    for suite_id in suite_ids:
        jql = f'parent = {suite_id} AND {SELENIUM_FILTER}'
        issues = await _jql_search(jql, ["summary", "components", "customfield_10100"])
        for issue in issues:
            fields = issue.get("fields", {})
            components = [c["name"] for c in fields.get("components", [])]
            test_cases.append(TestCase(
                jira_id=issue["key"],
                summary=fields.get("summary", ""),
                component=components[0] if components else "",
                sub_component=fields.get("customfield_10100", {}).get("value", "") if fields.get("customfield_10100") else "",
                layer_found=1,
                impact_score=0.0,
            ))

    return test_cases


async def layer2_component_search(components: dict[str, list[str]]) -> list[TestCase]:
    test_cases = []

    for component in components:
        jql = f'component = "{component}" AND {SELENIUM_FILTER}'
        issues = await _jql_search(jql, ["summary", "components"])
        for issue in issues:
            fields = issue.get("fields", {})
            test_cases.append(TestCase(
                    jira_id=issue["key"],
                    summary=fields.get("summary", ""),
                    component=component,
                    sub_component="",
                    layer_found=2,
                    impact_score=0.0,
                ))

    seen = set()
    unique = []
    for tc in test_cases:
        if tc.jira_id not in seen:
            seen.add(tc.jira_id)
            unique.append(tc)

    return unique
