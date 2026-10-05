import logging
import re
import uuid

from fastapi import APIRouter, Depends, Header

from app.api.dependencies import require_internal_api_key
from app.errors import ApplicationError
from app.providers.errors import ProviderError
from app.providers.protocol import GenerationProvider
from app.schemas.generation import GenerationRequest, GenerationResponse
from app.services.generation_service import generate_posts_with_usage

router = APIRouter()
logger = logging.getLogger("devsignal-ai-service")
_CORRELATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")


def _correlation_id(value: str | None) -> str:
    if value and _CORRELATION_ID_PATTERN.fullmatch(value):
        return value
    return str(uuid.uuid4())


@router.post("/generations", response_model=GenerationResponse, response_model_exclude_none=True)
async def create_generation(
    request: GenerationRequest,
    provider: GenerationProvider = Depends(require_internal_api_key),  # noqa: B008
    correlation_id: str | None = Header(default=None, alias="X-Correlation-ID"),
) -> GenerationResponse:
    request_correlation_id = _correlation_id(correlation_id)
    try:
        data, usage = await generate_posts_with_usage(provider, request)
    except ApplicationError as exception:
        cause = exception.__cause__
        diagnostic = cause if isinstance(cause, ProviderError) else None
        logger.info(
            "generation failed correlation_id=%s code=%s status=%d "
            "exception_class=%s stage=%s upstream_status=%s reason=%s",
            request_correlation_id,
            exception.code,
            exception.status_code,
            diagnostic.exception_class if diagnostic else type(cause).__name__ if cause else "none",
            diagnostic.stage if diagnostic else "unknown",
            diagnostic.upstream_status if diagnostic else "none",
            diagnostic.reason if diagnostic else "unknown",
        )
        raise
    return GenerationResponse(data=data, usage=usage)
