import asyncio
from app.models.schemas import Commit, TestCase, CoverageGap
from app.services.jira_service import get_ticket_details, search_tests_by_components


async def select_tests_for_commit(commit: Commit) -> tuple[list[TestCase], list[CoverageGap]]:
    all_tests: list[TestCase] = []
    gaps: list[CoverageGap] = []

    if not commit.jira_tickets:
        gaps.append(CoverageGap(
            repo=commit.repo,
            commit_id=commit.id,
            jira_tickets=[],
            reason="no_jira_link",
        ))
        return all_tests, gaps

    for ticket in commit.jira_tickets:
        details = await get_ticket_details(ticket)
        components = details["components"]

        if not components:
            gaps.append(CoverageGap(
                repo=commit.repo,
                commit_id=commit.id,
                jira_tickets=[ticket],
                reason="no_component_on_ticket",
            ))
            continue

        tests = await search_tests_by_components(components)
        all_tests.extend(tests)

        if not tests:
            gaps.append(CoverageGap(
                repo=commit.repo,
                commit_id=commit.id,
                jira_tickets=[ticket],
                reason="no_test_cases_found",
            ))

    seen: set[str] = set()
    unique: list[TestCase] = []
    for t in all_tests:
        if t.jira_id not in seen:
            seen.add(t.jira_id)
            unique.append(t)

    return unique, gaps


async def select_tests_for_commits(commits: list[Commit]) -> tuple[list[TestCase], list[CoverageGap]]:
    # Dedupe commits by ticket ID — get_ticket_details caches, but this avoids redundant work
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
    seen: set[str] = set()

    for tests, gaps in results:
        for t in tests:
            if t.jira_id not in seen:
                seen.add(t.jira_id)
                all_tests.append(t)
        all_gaps.extend(gaps)

    return all_tests, all_gaps
