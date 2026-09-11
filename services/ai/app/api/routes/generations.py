from fastapi import APIRouter, Depends

from app.api.dependencies import require_internal_api_key
from app.providers.protocol import GenerationProvider
from app.schemas.generation import GenerationRequest, GenerationResponse
from app.services.generation_service import generate_posts

router = APIRouter()


@router.post("/generations", response_model=GenerationResponse)
async def create_generation(
    request: GenerationRequest,
    provider: GenerationProvider = Depends(require_internal_api_key),  # noqa: B008
) -> GenerationResponse:
    data = await generate_posts(provider, request)
    return GenerationResponse(data=data)
