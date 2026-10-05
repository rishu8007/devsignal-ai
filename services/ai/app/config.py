from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2"
DEFAULT_GEMINI_EMBEDDING_DIMENSIONS = 1536
DEFAULT_QDRANT_COLLECTION = "devsignal_knowledge_chunks_gemini_v1"
LEGACY_OPENAI_QDRANT_COLLECTION = "devsignal_knowledge_chunks"


class Settings(BaseSettings):
    app_env: Literal["development", "test", "production"] = "development"
    host: str = Field(default="127.0.0.1", min_length=1)
    port: int = Field(default=8000, ge=1, le=65535)
    gemini_api_key: SecretStr = Field(default=SecretStr(""), min_length=1)
    gemini_model: str = Field(default=DEFAULT_GEMINI_MODEL, min_length=1)
    gemini_embedding_model: str = Field(default=DEFAULT_GEMINI_EMBEDDING_MODEL, min_length=1)
    gemini_embedding_dimensions: int = Field(
        default=DEFAULT_GEMINI_EMBEDDING_DIMENSIONS,
        ge=DEFAULT_GEMINI_EMBEDDING_DIMENSIONS,
        le=DEFAULT_GEMINI_EMBEDDING_DIMENSIONS,
    )
    qdrant_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:6333")
    qdrant_collection_name: str = Field(
        default=DEFAULT_QDRANT_COLLECTION,
        min_length=1,
        max_length=255,
    )
    qdrant_timeout_seconds: int = Field(default=10, ge=1, le=120)
    internal_api_key: SecretStr = Field(default=SecretStr(""), min_length=32)
    gemini_timeout_seconds: int = Field(default=45, ge=5, le=120)
    workflow_checkpoint_uri: str | None = Field(default=None, min_length=1)
    workflow_checkpoint_database: str = Field(default="devsignal_workflows", min_length=1)

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        validate_default=True,
    )

    @field_validator("qdrant_collection_name")
    @classmethod
    def validate_qdrant_collection_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("qdrant_collection_name must not be blank")
        if value == LEGACY_OPENAI_QDRANT_COLLECTION:
            raise ValueError(
                "qdrant_collection_name must use the Gemini collection "
                "devsignal_knowledge_chunks_gemini_v1"
            )
        return value

    @field_validator("workflow_checkpoint_uri", mode="before")
    @classmethod
    def normalize_workflow_checkpoint_uri(cls, value: str | None) -> str | None:
        return value.strip() or None if isinstance(value, str) else value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
