import json
from pathlib import Path
from app.models.schemas import Commit, TestCase, CoverageGap
from app.services.jira_service import get_tag_repos_for_ticket, layer2_component_search

_MAPPING_PATH = Path(__file__).parent.parent.parent / "config" / "repo_component_mapping.json"
with open(_MAPPING_PATH) as f:
    REPO_COMPONENT_MAP: dict[str, dict[str, list[str]]] = json.load(f)


async def select_tests_for_commit(commit: Commit) -> tuple[list[TestCase], list[CoverageGap]]:
    all_tests: list[TestCase] = []
    gaps: list[CoverageGap] = []

    if not commit.jira_tickets:
        # No ticket ID in commit message — use commit's own repo name in mapping
        tests = await _tests_for_repo(commit.repo)
        if tests:
            all_tests.extend(tests)
        else:
            gaps.append(CoverageGap(
                repo=commit.repo,
                commit_id=commit.id,
                jira_tickets=[],
                reason="no_jira_link",
            ))
        return all_tests, gaps

    for ticket in commit.jira_tickets:
        # A1: fetch Jira ticket → read Tag field → extract repo slug(s)
        tag_repos = await get_tag_repos_for_ticket(ticket)

        if tag_repos:
            # A2: look up each tag repo in mapping → query test cases
            for repo_slug in tag_repos:
                tests = await _tests_for_repo(repo_slug)
                all_tests.extend(tests)
        else:
            # Tag field empty — fall back to commit's own repo
            tests = await _tests_for_repo(commit.repo)
            all_tests.extend(tests)

        if not all_tests:
            gaps.append(CoverageGap(
                repo=commit.repo,
                commit_id=commit.id,
                jira_tickets=[ticket],
                reason="no_test_cases_found",
            ))

    # Deduplicate across tickets
    seen = set()
    unique_tests = []
    for t in all_tests:
        if t.jira_id not in seen:
            seen.add(t.jira_id)
            unique_tests.append(t)

    return unique_tests, gaps


async def _tests_for_repo(repo_slug: str) -> list[TestCase]:
    """Look up repo in mapping and query Jira for its test cases."""
    components = REPO_COMPONENT_MAP.get(repo_slug)
    if not components:
        return []
    return await layer2_component_search(components)


async def select_tests_for_commits(commits: list[Commit]) -> tuple[list[TestCase], list[CoverageGap]]:
    import asyncio

    # Deduplicate commits by ticket ID so we don't fire Jira for the same ticket 50x.
    # Commits without tickets are kept as-is (repo-based fallback).
    seen_tickets: set[str] = set()
    deduped: list[Commit] = []
    for c in commits:
        if not c.jira_tickets:
            deduped.append(c)
        else:
            new_tickets = [t for t in c.jira_tickets if t not in seen_tickets]
            if new_tickets:
                seen_tickets.update(new_tickets)
                deduped.append(c)

    results = await asyncio.gather(*[select_tests_for_commit(c) for c in deduped])

    all_tests: list[TestCase] = []
    all_gaps: list[CoverageGap] = []
    seen = set()

    for tests, gaps in results:
        for t in tests:
            if t.jira_id not in seen:
                seen.add(t.jira_id)
                all_tests.append(t)
        all_gaps.extend(gaps)

    return all_tests, all_gaps
