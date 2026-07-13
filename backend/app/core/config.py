from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    stash_base_url: str = "https://stash.example.com"
    stash_token: str = "placeholder"
    stash_project_key: str = ""
    # Comma-separated repo slugs to restrict scanning to (e.g. "global-invoice,edi-invoice").
    # Empty (default) = scan every repo in stash_project_key.
    stash_repo_allowlist: str = ""

    jira_base_url: str = "https://jira.example.com"
    jira_email: str = "user@example.com"
    jira_token: str = "placeholder"

    poll_interval_minutes: int = 15
    commit_lookback_days: int = 30
    frontend_url: str = "http://localhost:5173"

    # Coverage-based Test Impact Analysis (TIA) trial pipeline — see
    # backend/app/services/coverage/. Independent of the component-mapping
    # pipeline above; safe to leave at defaults if the trial isn't running.
    coverage_index_db_path: str = "data/coverage_index.db"
    coverage_exec_dropbox_dir: str = "data/coverage_raw"
    jacoco_report_helper_jar: str = "tools/jacoco-report-helper/target/jacoco-report-helper.jar"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
