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
    impact_score: float


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
    status: str  # matched | no_ticket | no_component | no_permission


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
