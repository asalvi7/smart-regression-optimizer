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

    # Track best (lowest id = highest severity) priority per test within this commit
    best_priority: dict[str, str] = {}

    for ticket in commit.jira_tickets:
        details = await get_ticket_details(ticket)
        # Use mapped Jira component names for test search; fall back to raw slugs
        components = details.get("jira_components") or details["components"]
        priority_id = details.get("priority_id", "4")

        if not components:
            gaps.append(CoverageGap(
                repo=commit.repo,
                commit_id=commit.id,
                jira_tickets=[ticket],
                reason="no_component_on_ticket",
            ))
            continue

        tests = await search_tests_by_components(components)
        for t in tests:
            # Keep the highest severity (lowest id number) seen for this test
            if t.jira_id not in best_priority or int(priority_id) < int(best_priority[t.jira_id]):
                best_priority[t.jira_id] = priority_id
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
            t.ticket_priority_id = best_priority.get(t.jira_id, "4")
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

    # Aggregate frequency and best priority across all commit results
    frequency_map: dict[str, int] = {}
    best_priority_map: dict[str, str] = {}
    all_gaps: list[CoverageGap] = []

    for tests, gaps in results:
        for t in tests:
            frequency_map[t.jira_id] = frequency_map.get(t.jira_id, 0) + 1
            pid = t.ticket_priority_id
            if t.jira_id not in best_priority_map or int(pid) < int(best_priority_map[t.jira_id]):
                best_priority_map[t.jira_id] = pid
        all_gaps.extend(gaps)

    # Global dedup — stamp frequency + best priority on first occurrence
    seen: set[str] = set()
    all_tests: list[TestCase] = []
    for tests, _ in results:
        for t in tests:
            if t.jira_id not in seen:
                seen.add(t.jira_id)
                t.frequency = frequency_map[t.jira_id]
                t.ticket_priority_id = best_priority_map.get(t.jira_id, "4")
                all_tests.append(t)

    return all_tests, all_gaps
