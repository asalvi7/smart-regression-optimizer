import json
import httpx
import base64
import asyncio
from pathlib import Path
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

# Base eligibility filter for any test-case search in this pipeline: must be an
# automated, non-retired regression ST-Test Case with a linked test script (cf[10225]).
TEST_CASE_FILTER = (
    '(project = ADINFRA OR project = Prisma OR project = IAPP)'
    ' AND type = "ST-Test Case"'
    ' AND ("Regression Item" = Yes OR Regression = Yes)'
    ' AND Automated = Yes'
    ' AND cf[10225] is not EMPTY'
    ' AND ("Automated (migrated)[Dropdown]" not in (Retired)'
    ' OR "Automated[Dropdown]" not in (Retired)'
    ' OR Automated not in (Retired))'
)

# This Jira instance doesn't use the system Components field for Prisma work —
# it uses custom fields: cf[10205] "Components - Prisma" and cf[10206]
# "Sub-Components - Prisma" (confirmed via GET /rest/api/3/field). Both are
# single-select, unlike the system "components" field which is multi-value.
COMPONENT_FIELD = "cf[10205]"
SUB_COMPONENT_FIELD = "cf[10206]"

_TAG_COMPONENT_MAPPING_PATH = (
    Path(__file__).resolve().parents[2] / "config" / "tag_component_mapping.json"
)


def _load_tag_component_mapping() -> tuple[str, dict[str, dict]]:
    """
    Load the tag-slug → {component, sub_component} mapping. Edit
    backend/config/tag_component_mapping.json to add new tags — no code
    changes needed. Any tag slug not present in "tag_overrides" falls back to
    "default_component" with no sub-component filter.
    """
    with open(_TAG_COMPONENT_MAPPING_PATH) as f:
        data = json.load(f)
    return data["default_component"], data.get("tag_overrides", {})


_DEFAULT_COMPONENT, _TAG_OVERRIDES = _load_tag_component_mapping()


def resolve_component_for_slug(slug: str) -> tuple[str, str | None]:
    """Map a repo/tag slug to (component, sub_component | None) per tag_component_mapping.json."""
    override = _TAG_OVERRIDES.get(slug)
    if override:
        return override["component"], override.get("sub_component")
    return _DEFAULT_COMPONENT, None

# Max concurrent requests to Jira to avoid 429 rate limiting
_JIRA_SEMAPHORE = asyncio.Semaphore(3)
_SEARCH_SEMAPHORE = asyncio.Semaphore(3)

# Cache tag lookups so the same ticket is never fetched twice in one run
_tag_cache: dict[str, list[str]] = {}
_tag_text_cache: dict[str, str] = {}  # raw tag text for display in trace

# Cache test search results by component set — components change rarely so this is safe to persist
_search_cache: dict[tuple, list[TestCase]] = {}


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

            for attempt in range(3):
                resp = await client.post(
                    f"{settings.jira_base_url}/rest/api/3/search/jql",
                    headers=JIRA_HEADERS,
                    json=payload,
                )
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", 5 * (attempt + 1)))
                    print(f"[jira] 429 rate limit — waiting {retry_after}s (attempt {attempt+1})")
                    await asyncio.sleep(retry_after)
                    continue
                resp.raise_for_status()
                break
            else:
                print(f"[jira] gave up after 3 retries on 429 — skipping page")
                break

            data = resp.json()
            issues.extend(data.get("issues", []))
            next_page_token = data.get("nextPageToken")
            if not next_page_token or data.get("isLast", True):
                break

    return issues


# customfield_10169 = Product (multi-select). Only tickets carrying "Prisma"
# among their Product values are considered by the ingestion pipeline.
PRODUCT_FIELD = "customfield_10169"
PRODUCT_FILTER_VALUE = "Prisma"


def _extract_product_values(customfield_10169) -> list[str]:
    """Pull the selected value(s) out of the Product field — it's a multi-select, so a JSON array of options."""
    if not customfield_10169:
        return []
    if isinstance(customfield_10169, list):
        return [item.get("value", "") for item in customfield_10169 if isinstance(item, dict)]
    if isinstance(customfield_10169, dict):
        return [customfield_10169.get("value", "")]
    return []


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
      'campaign-management-2026.5.173'
      'prisma-locale-bundle:2026.5.6, campaign-management:2026.5.80'
    Returns the repo slug prefix(es): ['campaign-management', 'prisma-locale-bundle']
    """
    import re
    slugs = []
    for part in re.split(r'[,;]', tag_text):
        part = part.strip()
        # Match repo slug before :, /, or -<version> pattern
        match = re.match(r'^([a-z0-9\-]+?)(?:[:/\-](?:\d+\.|\d{4}))', part)
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
    Fetch a feature ticket and return tag, repo slugs, components, and Product match.
    Repo slugs extracted from the Tag field are resolved to Jira
    component/sub-component names via tag_component_mapping.json
    (see resolve_component_for_slug).
    Returns: {tag: str, slugs: list[str], components: list[str], sub_components: list[str], is_prisma: bool}
    """
    if ticket_id in _ticket_details_cache:
        return _ticket_details_cache[ticket_id]

    async with _JIRA_SEMAPHORE:
        if ticket_id in _ticket_details_cache:
            return _ticket_details_cache[ticket_id]

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{settings.jira_base_url}/rest/api/3/issue/{ticket_id}"
                f"?fields=customfield_10313,{PRODUCT_FIELD}",
                headers=JIRA_HEADERS,
            )
            if resp.status_code == 401:
                result = {"tag": "", "slugs": [], "components": [], "sub_components": [], "is_prisma": False, "error": "auth_failed"}
                _ticket_details_cache[ticket_id] = result
                return result
            if resp.status_code in (403, 404):
                result = {"tag": "", "slugs": [], "components": [], "sub_components": [], "is_prisma": False, "error": "no_permission"}
                _ticket_details_cache[ticket_id] = result
                _tag_text_cache[ticket_id] = ""
                _tag_cache[ticket_id] = []
                return result
            resp.raise_for_status()
            fields = resp.json().get("fields", {})

    tag_text = _extract_tag_text(fields.get("customfield_10313"))
    slugs = extract_repo_slugs_from_tag(tag_text)

    resolved = [resolve_component_for_slug(slug) for slug in slugs]
    components = sorted({component for component, _ in resolved})
    sub_components = sorted({sc for _, sc in resolved if sc})

    product_values = _extract_product_values(fields.get(PRODUCT_FIELD))
    is_prisma = PRODUCT_FILTER_VALUE in product_values

    result = {"tag": tag_text, "slugs": slugs, "components": components, "sub_components": sub_components, "is_prisma": is_prisma, "error": None}
    _ticket_details_cache[ticket_id] = result
    _tag_text_cache[ticket_id] = tag_text
    _tag_cache[ticket_id] = slugs
    return result


def _build_component_clause(component: str, sub_component: str | None) -> str:
    if sub_component:
        return f'({COMPONENT_FIELD} = "{component}" AND {SUB_COMPONENT_FIELD} = "{sub_component}")'
    return f'({COMPONENT_FIELD} = "{component}")'


async def search_tests_by_tag_slugs(slugs: list[str]) -> list[TestCase]:
    """
    Search test cases for a ticket's tag slug(s), resolved to component/sub-component
    pairs via tag_component_mapping.json — batched into one JQL query, result cached.
    """
    if not slugs:
        return []

    clauses: list[str] = []
    seen_clauses: set[str] = set()
    for slug in slugs:
        component, sub_component = resolve_component_for_slug(slug)
        clause = _build_component_clause(component, sub_component)
        if clause not in seen_clauses:
            seen_clauses.add(clause)
            clauses.append(clause)

    cache_key = tuple(sorted(clauses))
    if cache_key in _search_cache:
        return _search_cache[cache_key]

    async with _SEARCH_SEMAPHORE:
        # Re-check after acquiring semaphore — another coroutine may have populated it
        if cache_key in _search_cache:
            return _search_cache[cache_key]

        component_expr = " OR ".join(clauses)
        jql = f'({component_expr}) AND {TEST_CASE_FILTER} ORDER BY "Latest date"'
        issues = await _jql_search(jql, ["summary", "customfield_10205", "customfield_10206", "priority"])

        component_names = {c for c, _ in (resolve_component_for_slug(s) for s in slugs)}
        test_cases = []
        for issue in issues:
            fields = issue.get("fields", {})
            comp = fields.get("customfield_10205")
            component = comp.get("value", "") if comp else next(iter(component_names))
            sub_comp = fields.get("customfield_10206")
            sub_component = sub_comp.get("value", "") if sub_comp else ""
            priority_id = str(fields.get("priority", {}).get("id", "4")) if fields.get("priority") else "4"
            test_cases.append(TestCase(
                jira_id=issue["key"],
                summary=fields.get("summary", ""),
                component=component,
                sub_component=sub_component,
                layer_found=2,
                priority_id=priority_id,
            ))

        seen: set[str] = set()
        unique = []
        for tc in test_cases:
            if tc.jira_id not in seen:
                seen.add(tc.jira_id)
                unique.append(tc)

        _search_cache[cache_key] = unique
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
        jql = f'parent = {suite_id} AND {TEST_CASE_FILTER}'
        issues = await _jql_search(jql, ["summary", "customfield_10205", "customfield_10206"])
        for issue in issues:
            fields = issue.get("fields", {})
            comp = fields.get("customfield_10205")
            sub_comp = fields.get("customfield_10206")
            test_cases.append(TestCase(
                jira_id=issue["key"],
                summary=fields.get("summary", ""),
                component=comp.get("value", "") if comp else "",
                sub_component=sub_comp.get("value", "") if sub_comp else "",
                layer_found=1,
            ))

    return test_cases


async def layer2_component_search(components: dict[str, list[str]]) -> list[TestCase]:
    test_cases = []

    for component in components:
        jql = f'{COMPONENT_FIELD} = "{component}" AND {TEST_CASE_FILTER}'
        issues = await _jql_search(jql, ["summary", "customfield_10205"])
        for issue in issues:
            fields = issue.get("fields", {})
            test_cases.append(TestCase(
                    jira_id=issue["key"],
                    summary=fields.get("summary", ""),
                    component=component,
                    sub_component="",
                    layer_found=2,
                ))

    seen = set()
    unique = []
    for tc in test_cases:
        if tc.jira_id not in seen:
            seen.add(tc.jira_id)
            unique.append(tc)

    return unique
