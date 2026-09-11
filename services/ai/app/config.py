from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: Literal["development", "test", "production"] = "development"
    host: str = Field(default="127.0.0.1", min_length=1)
    port: int = Field(default=8000, ge=1, le=65535)
    openai_api_key: SecretStr = Field(default=SecretStr(""), min_length=1)
    openai_model: str = Field(default="gpt-5.6-luna", min_length=1)
    internal_api_key: SecretStr = Field(default=SecretStr(""), min_length=32)
    openai_timeout_seconds: int = Field(default=45, ge=5, le=120)

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        validate_default=True,
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
