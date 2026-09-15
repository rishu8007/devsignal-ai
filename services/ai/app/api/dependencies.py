import secrets
from typing import cast

from fastapi import Header, Request

from app.config import get_settings
from app.errors import SERVICE_AUTHENTICATION_ERROR
from app.providers.protocol import GenerationProvider
from app.services.retrieval import RetrievalService
from app.services.source_indexing import SourceIndexingService


def require_internal_api_key(
    request: Request, x_internal_api_key: str | None = Header(default=None)
) -> GenerationProvider:
    expected = get_settings().internal_api_key.get_secret_value().encode("utf-8")
    provided = (x_internal_api_key or "").encode("utf-8")
    if not secrets.compare_digest(expected, provided):
        raise SERVICE_AUTHENTICATION_ERROR
    return cast(GenerationProvider, request.app.state.provider)


def require_internal_indexing_service(
    request: Request, x_internal_api_key: str | None = Header(default=None)
) -> SourceIndexingService:
    expected = get_settings().internal_api_key.get_secret_value().encode("utf-8")
    provided = (x_internal_api_key or "").encode("utf-8")
    if not secrets.compare_digest(expected, provided):
        raise SERVICE_AUTHENTICATION_ERROR
    return cast(SourceIndexingService, request.app.state.indexing_service)


def require_internal_retrieval_service(
    request: Request, x_internal_api_key: str | None = Header(default=None)
) -> RetrievalService:
    expected = get_settings().internal_api_key.get_secret_value().encode("utf-8")
    provided = (x_internal_api_key or "").encode("utf-8")
    if not secrets.compare_digest(expected, provided):
        raise SERVICE_AUTHENTICATION_ERROR
    return cast(RetrievalService, request.app.state.retrieval_service)
