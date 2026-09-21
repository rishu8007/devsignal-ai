import secrets
from typing import Any, cast

from fastapi import Header, Request

from app.config import get_settings
from app.errors import SERVICE_AUTHENTICATION_ERROR, ApplicationError
from app.providers.draft_review_provider import DraftReviewProvider
from app.providers.protocol import GenerationProvider
from app.providers.research_brief_provider import ResearchBriefProvider
from app.providers.topic_planning_provider import TopicPlanningProvider
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


def require_internal_research_retrieval_service(
    request: Request, x_internal_api_key: str | None = Header(default=None)
) -> RetrievalService:
    expected = get_settings().internal_api_key.get_secret_value().encode("utf-8")
    provided = (x_internal_api_key or "").encode("utf-8")
    if not secrets.compare_digest(expected, provided):
        raise SERVICE_AUTHENTICATION_ERROR
    return cast(RetrievalService, request.app.state.research_retrieval_service)


def require_internal_topic_planning_provider(
    request: Request, x_internal_api_key: str | None = Header(default=None)
) -> TopicPlanningProvider:
    expected = get_settings().internal_api_key.get_secret_value().encode("utf-8")
    provided = (x_internal_api_key or "").encode("utf-8")
    if not secrets.compare_digest(expected, provided):
        raise SERVICE_AUTHENTICATION_ERROR
    return cast(TopicPlanningProvider, request.app.state.topic_planning_provider)


def require_internal_research_brief_provider(
    request: Request, x_internal_api_key: str | None = Header(default=None)
) -> ResearchBriefProvider:
    expected = get_settings().internal_api_key.get_secret_value().encode("utf-8")
    provided = (x_internal_api_key or "").encode("utf-8")
    if not secrets.compare_digest(expected, provided):
        raise SERVICE_AUTHENTICATION_ERROR
    return cast(ResearchBriefProvider, request.app.state.research_brief_provider)


def require_internal_draft_review_provider(
    request: Request, x_internal_api_key: str | None = Header(default=None)
) -> DraftReviewProvider:
    expected = get_settings().internal_api_key.get_secret_value().encode("utf-8")
    provided = (x_internal_api_key or "").encode("utf-8")
    if not secrets.compare_digest(expected, provided):
        raise SERVICE_AUTHENTICATION_ERROR
    return cast(DraftReviewProvider, request.app.state.draft_review_provider)


def require_internal_workflow_graph(
    request: Request, x_internal_api_key: str | None = Header(default=None)
) -> Any:
    expected = get_settings().internal_api_key.get_secret_value().encode("utf-8")
    provided = (x_internal_api_key or "").encode("utf-8")
    if not secrets.compare_digest(expected, provided):
        raise SERVICE_AUTHENTICATION_ERROR
    graph = request.app.state.workflow_graph
    if graph is None:
        raise ApplicationError(
            503,
            "WORKFLOW_CHECKPOINT_UNAVAILABLE",
            "Durable workflow checkpoints are not configured",
        )
    return graph
