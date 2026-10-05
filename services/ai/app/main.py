import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import monotonic
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from google import genai
from google.genai import types
from langgraph.checkpoint.mongodb import MongoDBSaver
from pymongo import MongoClient
from qdrant_client import AsyncQdrantClient

from app.api.router import router
from app.config import get_settings
from app.errors import ApplicationError
from app.providers.gemini_embedding_provider import GeminiEmbeddingClient, GeminiEmbeddingProvider
from app.providers.gemini_provider import (
    GeminiAsyncClient,
    GeminiDraftReviewProvider,
    GeminiGenerationProvider,
    GeminiResearchBriefProvider,
    GeminiStructuredClient,
    GeminiTopicPlanningProvider,
)
from app.repositories.qdrant_repository import QdrantAPI, QdrantVectorRepository
from app.services.retrieval import RetrievalService
from app.services.source_indexing import EmbeddingConfiguration, SourceIndexingService
from app.workflow_graph import build_workflow_graph

logger = logging.getLogger("devsignal-ai-service")

# Ensure the logger emits INFO-level messages to stdout
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter(
        "%(levelname)s:%(name)s:%(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    application.state.started_at = monotonic()
    raw_gemini_client: genai.Client | None = None
    gemini_client: GeminiAsyncClient | None = None
    structured_client: GeminiStructuredClient | None = None
    workflow_checkpoint_client: MongoClient[dict[str, Any]] | None = None
    workflow_checkpointer: MongoDBSaver | None = None
    qdrant_client: AsyncQdrantClient | None = None
    try:
        raw_gemini_client = genai.Client(
            api_key=settings.gemini_api_key.get_secret_value(),
            http_options=types.HttpOptions(
                timeout=int(settings.gemini_timeout_seconds * 1000),
            ),
        )
        gemini_client = cast(GeminiAsyncClient, raw_gemini_client.aio)
        structured_client = GeminiStructuredClient(
            gemini_client,
            settings.gemini_model,
            timeout_seconds=settings.gemini_timeout_seconds,
            retry_attempts=2,
        )
        application.state.provider = GeminiGenerationProvider(structured_client)
        application.state.topic_planning_provider = GeminiTopicPlanningProvider(structured_client)
        application.state.research_brief_provider = GeminiResearchBriefProvider(structured_client)
        application.state.draft_review_provider = GeminiDraftReviewProvider(structured_client)

        if settings.workflow_checkpoint_uri:
            workflow_checkpoint_client = MongoClient(settings.workflow_checkpoint_uri)
            workflow_checkpointer = MongoDBSaver(
                workflow_checkpoint_client,
                db_name=settings.workflow_checkpoint_database,
            )
            application.state.workflow_graph = build_workflow_graph(
                application.state.research_brief_provider,
                application.state.provider,
                application.state.draft_review_provider,
                workflow_checkpointer,
            )
        else:
            application.state.workflow_graph = None

        application.state.embedding_provider = GeminiEmbeddingProvider(
            cast(GeminiEmbeddingClient, gemini_client),
            settings.gemini_embedding_model,
            settings.gemini_embedding_dimensions,
            timeout_seconds=settings.gemini_timeout_seconds,
        )
        application.state.research_embedding_provider = application.state.embedding_provider
        qdrant_client = AsyncQdrantClient(
            url=str(settings.qdrant_url),
            timeout=settings.qdrant_timeout_seconds,
        )
        application.state.qdrant_repository = QdrantVectorRepository(
            cast(QdrantAPI, qdrant_client),
            settings.qdrant_collection_name,
            settings.gemini_embedding_dimensions,
            settings.qdrant_timeout_seconds,
        )
        embedding_configuration = EmbeddingConfiguration(
            model=settings.gemini_embedding_model,
            dimensions=settings.gemini_embedding_dimensions,
        )
        application.state.indexing_service = SourceIndexingService(
            application.state.embedding_provider,
            application.state.qdrant_repository,
            embedding_configuration,
        )
        application.state.retrieval_service = RetrievalService(
            application.state.embedding_provider,
            application.state.qdrant_repository,
            embedding_configuration,
        )
        application.state.research_retrieval_service = RetrievalService(
            application.state.research_embedding_provider,
            application.state.qdrant_repository,
            embedding_configuration,
        )
        logger.info("DevSignal AI service started")
        yield
    finally:
        try:
            if structured_client is not None:
                await structured_client.close()
            elif gemini_client is not None:
                await gemini_client.aclose()
            elif raw_gemini_client is not None:
                await raw_gemini_client.aio.aclose()
        finally:
            try:
                if workflow_checkpointer is not None:
                    workflow_checkpointer.close()
            finally:
                try:
                    if workflow_checkpoint_client is not None:
                        workflow_checkpoint_client.close()
                finally:
                    if qdrant_client is not None:
                        await qdrant_client.close()
        logger.info("DevSignal AI service stopped")


app = FastAPI(title="DevSignal AI Service", version="0.1.0", lifespan=lifespan)
app.include_router(router)


@app.exception_handler(404)
async def not_found_handler(_request: Request, _exception: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={
            "success": False,
            "error": {"code": "ROUTE_NOT_FOUND", "message": "Route not found"},
        },
    )


@app.exception_handler(ApplicationError)
async def application_error_handler(_request: Request, exception: ApplicationError) -> JSONResponse:
    return JSONResponse(
        status_code=exception.status_code,
        content={"success": False, "error": exception.error_body()},
    )


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    _request: Request, exception: RequestValidationError
) -> JSONResponse:
    fields: dict[str, list[str]] = {}
    for error in exception.errors():
        location = error.get("loc", ())
        field = str(location[-1]) if location else "request"
        fields.setdefault(field, []).append("Invalid value")
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Invalid request data",
                "details": {"fields": fields},
            },
        },
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(_request: Request, exception: Exception) -> JSONResponse:
    logger.exception("Unhandled application error", exc_info=exception)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred",
            },
        },
    )
