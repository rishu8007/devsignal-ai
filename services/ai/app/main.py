import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import monotonic
from typing import cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from openai import AsyncOpenAI
from qdrant_client import AsyncQdrantClient

from app.api.router import router
from app.config import get_settings
from app.errors import ApplicationError
from app.providers.embedding_provider import EmbeddingsAPI, OpenAIEmbeddingProvider
from app.providers.openai_provider import OpenAIProvider, ResponsesAPI
from app.repositories.qdrant_repository import QdrantAPI, QdrantVectorRepository

logger = logging.getLogger("devsignal-ai-service")


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    application.state.started_at = monotonic()
    client = AsyncOpenAI(
        api_key=settings.openai_api_key.get_secret_value(),
        timeout=settings.openai_timeout_seconds,
        max_retries=2,
    )
    application.state.provider = OpenAIProvider(
        cast(ResponsesAPI, client.responses),
        client.close,
        settings.openai_model,
    )
    application.state.embedding_provider = OpenAIEmbeddingProvider(
        cast(EmbeddingsAPI, client.embeddings),
        settings.openai_embedding_model,
        settings.openai_embedding_dimensions,
    )
    qdrant_client = AsyncQdrantClient(
        url=str(settings.qdrant_url),
        timeout=settings.qdrant_timeout_seconds,
    )
    application.state.qdrant_repository = QdrantVectorRepository(
        cast(QdrantAPI, qdrant_client),
        settings.qdrant_collection_name,
        settings.openai_embedding_dimensions,
        settings.qdrant_timeout_seconds,
    )
    logger.info("DevSignal AI service started")
    try:
        yield
    finally:
        try:
            await application.state.provider.close()
        finally:
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
