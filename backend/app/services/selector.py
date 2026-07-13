import asyncio
from app.models.schemas import Commit, TestCase, CoverageGap
from app.services.jira_service import get_ticket_details, search_tests_by_tag_slugs


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

        # Only Product = Prisma tickets are in scope; tickets that don't match (or
        # couldn't be read) are silently excluded — not shown as a gap.
        if not details.get("is_prisma"):
            continue

        slugs = details["slugs"]

        # No Tag field means this is likely a dev-only ticket with no functional
        # impact to trace to test cases — silently excluded, not shown as a gap.
        if not slugs:
            continue

        tests = await search_tests_by_tag_slugs(slugs)
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

    # Aggregate frequency (how many distinct tickets triggered each test case)
    frequency_map: dict[str, int] = {}
    all_gaps: list[CoverageGap] = []

    for tests, gaps in results:
        for t in tests:
            frequency_map[t.jira_id] = frequency_map.get(t.jira_id, 0) + 1
        all_gaps.extend(gaps)

    # Global dedup — stamp frequency on first occurrence; priority_id already
    # comes from the test case's own Jira priority (set in jira_service.py)
    seen: set[str] = set()
    all_tests: list[TestCase] = []
    for tests, _ in results:
        for t in tests:
            if t.jira_id not in seen:
                seen.add(t.jira_id)
                t.frequency = frequency_map[t.jira_id]
                all_tests.append(t)

    return all_tests, all_gaps
