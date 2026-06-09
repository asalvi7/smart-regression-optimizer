from pydantic import BaseModel
from typing import List


class RepoActivity(BaseModel):
    name: str
    slug: str
    commit_count: int
    last_commit_date: str
    authors: List[str]
    repo_url: str


class DateRange(BaseModel):
    from_date: str
    to_date: str


class ActiveReposResponse(BaseModel):
    date_range: DateRange
    total_repos_scanned: int
    active_repos: int
    repos: List[RepoActivity]
