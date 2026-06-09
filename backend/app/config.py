from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    stash_base_url: str
    stash_token: str
    stash_project_key: str = "CM"
    stash_page_limit: int = 100

    jira_base_url: str = ""
    jira_token: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
