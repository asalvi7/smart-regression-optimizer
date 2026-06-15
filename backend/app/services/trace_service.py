import asyncio
from app.models.schemas import CommitTrace, PipelineTraceResponse
from app.services.stash_service import get_all_repos, get_repos_with_recent_commits
from app.services.jira_service import get_ticket_details


async def build_pipeline_trace(since_days: int) -> PipelineTraceResponse:
    all_repos, repo_commits = await asyncio.gather(
        get_all_repos(),
        get_repos_with_recent_commits(since_days=since_days),
    )

    # Pre-fetch all unique ticket details concurrently
    all_tickets = {
        ticket
        for commits in repo_commits.values()
        for commit in commits
        for ticket in commit.jira_tickets
    }
    await asyncio.gather(*[get_ticket_details(t) for t in all_tickets])

    traces = []
    for repo_slug, commits in repo_commits.items():
        for commit in commits:
            message = commit.message[:120].split("\n")[0]
            trace = CommitTrace(
                commit_id=commit.id[:8],
                repo=repo_slug,
                message=message,
                author=commit.author,
                timestamp=commit.timestamp,
                tickets=commit.jira_tickets,
                ticket_tags={},
                ticket_slugs={},
                ticket_components={},
                ticket_sub_components={},
                status="pending",
            )

            if not commit.jira_tickets:
                trace.status = "no_ticket"
            else:
                has_permission_error = False
                for ticket in commit.jira_tickets:
                    details = await get_ticket_details(ticket)  # cache hit
                    trace.ticket_tags[ticket] = details["tag"]
                    trace.ticket_slugs[ticket] = details["slugs"]
                    trace.ticket_components[ticket] = details["components"]
                    trace.ticket_sub_components[ticket] = details.get("sub_components", [])
                    if details.get("error") in ("no_permission", "auth_failed"):
                        has_permission_error = True

                has_components = any(bool(v) for v in trace.ticket_components.values())
                if has_components:
                    trace.status = "matched"
                elif has_permission_error:
                    trace.status = "no_permission"
                else:
                    trace.status = "no_component"

            traces.append(trace)

    return PipelineTraceResponse(
        since_days=since_days,
        repos_scanned=len(all_repos),
        repos_with_changes=len(repo_commits),
        commits_processed=len(traces),
        trace=traces,
    )
