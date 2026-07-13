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
                commit_id=commit.id,
                repo=repo_slug,
                message=message,
                author=commit.author,
                timestamp=commit.timestamp,
                tickets=commit.jira_tickets,
                ticket_tags={},
                ticket_slugs={},
                ticket_components={},
                ticket_sub_components={},
                ticket_is_prisma={},
                ticket_status={},
                status="pending",
            )

            if not commit.jira_tickets:
                trace.status = "no_ticket"
            else:
                # Ingestion scope, in order: Product = Prisma → has Tag → resolves to a component.
                # Mirrors selector.py's filtering exactly, so this trace reflects what actually
                # reaches the Recommended Tests tab.
                STATUS_PRIORITY = ["no_permission", "not_prisma", "no_tag", "no_component", "matched"]
                for ticket in commit.jira_tickets:
                    details = await get_ticket_details(ticket)  # cache hit
                    trace.ticket_tags[ticket] = details["tag"]
                    trace.ticket_slugs[ticket] = details["slugs"]
                    trace.ticket_components[ticket] = details["components"]
                    trace.ticket_sub_components[ticket] = details.get("sub_components", [])
                    trace.ticket_is_prisma[ticket] = details.get("is_prisma", False)

                    if details.get("error") in ("no_permission", "auth_failed"):
                        ticket_status = "no_permission"
                    elif not details.get("is_prisma"):
                        ticket_status = "not_prisma"
                    elif not details["slugs"]:
                        ticket_status = "no_tag"
                    elif details["components"]:
                        ticket_status = "matched"
                    else:
                        ticket_status = "no_component"
                    trace.ticket_status[ticket] = ticket_status

                # Commit-level status: matched if any ticket matched, else the
                # highest-priority reason among the rest.
                statuses = set(trace.ticket_status.values())
                trace.status = "matched" if "matched" in statuses else \
                    next(s for s in STATUS_PRIORITY if s in statuses)

            traces.append(trace)

    return PipelineTraceResponse(
        since_days=since_days,
        repos_scanned=len(all_repos),
        repos_with_changes=len(repo_commits),
        commits_processed=len(traces),
        trace=traces,
    )
