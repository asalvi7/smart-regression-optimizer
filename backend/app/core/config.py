from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    stash_base_url: str = "https://stash.example.com"
    stash_token: str = "placeholder"
    stash_project_key: str = "CM"

    jira_base_url: str = "https://jira.example.com"
    jira_email: str = "user@example.com"
    jira_token: str = "placeholder"

    poll_interval_minutes: int = 15
    commit_lookback_days: int = 30
    frontend_url: str = "http://localhost:5173"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
