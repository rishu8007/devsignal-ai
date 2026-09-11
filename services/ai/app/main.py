import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import monotonic

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.router import router
from app.config import get_settings

logger = logging.getLogger("devsignal-ai-service")


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    application.state.started_at = monotonic()
    logger.info("DevSignal AI service started")
    try:
        yield
    finally:
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


settings = get_settings()
