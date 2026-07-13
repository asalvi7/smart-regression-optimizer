from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class Commit(BaseModel):
    id: str
    message: str
    author: str
    timestamp: datetime
    repo: str
    jira_tickets: list[str]


class TestCase(BaseModel):
    jira_id: str
    summary: str
    component: str
    sub_component: str
    layer_found: int
    frequency: int = 1          # how many commits triggered this test case
    priority_id: str = "4"      # the test case issue's own Jira priority


class CoverageGap(BaseModel):
    repo: str
    commit_id: str
    jira_tickets: list[str]
    reason: str


class RegressionEvent(BaseModel):
    id: str
    detected_at: datetime
    repos_changed: list[str]
    commits: list[Commit]
    recommended_tests: list[TestCase]
    coverage_gaps: list[CoverageGap]
    total_tests_saved: int


class CommitTrace(BaseModel):
    commit_id: str
    repo: str
    message: str
    author: str
    timestamp: datetime
    tickets: list[str]
    ticket_tags: dict[str, str]             # ticket -> raw tag text
    ticket_slugs: dict[str, list[str]]      # ticket -> repo slugs from tag
    ticket_components: dict[str, list[str]]     # ticket -> component names (customfield_10205)
    ticket_sub_components: dict[str, list[str]] # ticket -> sub-component names (customfield_10206)
    ticket_is_prisma: dict[str, bool]           # ticket -> Product field contains "Prisma" (customfield_10169)
    ticket_status: dict[str, str]               # ticket -> matched | not_prisma | no_tag | no_component | no_permission
    status: str  # matched | no_ticket | not_prisma | no_tag | no_component | no_permission


class PipelineTraceResponse(BaseModel):
    since_days: int
    repos_scanned: int
    repos_with_changes: int
    commits_processed: int
    trace: list[CommitTrace]


class CommitScanRequest(BaseModel):
    since_days: int = 7


class CommitScanResponse(BaseModel):
    repos_scanned: int
    repos_with_changes: int
    commits: list[Commit]
    scan_from: datetime
    scan_to: datetime
