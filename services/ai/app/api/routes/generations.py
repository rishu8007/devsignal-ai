from fastapi import APIRouter, Depends

from app.api.dependencies import require_internal_api_key
from app.providers.protocol import GenerationProvider
from app.schemas.generation import GenerationRequest, GenerationResponse
from app.services.generation_service import generate_posts_with_usage

router = APIRouter()


@router.post("/generations", response_model=GenerationResponse, response_model_exclude_none=True)
async def create_generation(
    request: GenerationRequest,
    provider: GenerationProvider = Depends(require_internal_api_key),  # noqa: B008
) -> GenerationResponse:
    data, usage = await generate_posts_with_usage(provider, request)
    return GenerationResponse(data=data, usage=usage)
