from collections.abc import Sequence

from app.errors import ApplicationError
from app.providers.openai_provider import ProviderError
from app.providers.protocol import GenerationProvider
from app.schemas.generation import (
    Angle,
    GenerationData,
    GenerationRequest,
    GenerationVariation,
)

REQUIRED_ANGLES: tuple[Angle, ...] = (
    "technical_depth",
    "learning_story",
    "professional_impact",
)


async def generate_posts(
    provider: GenerationProvider, request: GenerationRequest
) -> GenerationData:
    try:
        result = await provider.generate(request)
        variations = _normalize_variations(result.output.variations)
        _validate_citations(variations, request)
    except ProviderError as exception:
        error_map = {
            "timeout": (504, "AI_PROVIDER_TIMEOUT", "The AI provider timed out"),
            "rate_limit": (503, "AI_PROVIDER_RATE_LIMITED", "The AI service is temporarily busy"),
            "unavailable": (503, "AI_PROVIDER_UNAVAILABLE", "The AI service is unavailable"),
            "provider": (502, "AI_PROVIDER_ERROR", "The AI provider request failed"),
            "refused": (
                422,
                "AI_GENERATION_REFUSED",
                "The requested content could not be generated",
            ),
            "invalid_response": (
                502,
                "AI_INVALID_RESPONSE",
                "The AI provider returned an invalid response",
            ),
        }
        status_code, code, message = error_map.get(
            exception.kind,
            (502, "AI_PROVIDER_ERROR", "The AI provider request failed"),
        )
        raise ApplicationError(status_code, code, message) from exception
    except ApplicationError:
        raise
    except Exception as exception:
        raise ApplicationError(
            502,
            "AI_INVALID_RESPONSE",
            "The AI provider returned an invalid response",
        ) from exception
    return GenerationData(variations=variations, model=result.model)


def _normalize_variations(
    variations: Sequence[GenerationVariation],
) -> list[GenerationVariation]:
    if len(variations) != len(REQUIRED_ANGLES):
        raise ValueError("invalid variation count")
    by_angle: dict[Angle, GenerationVariation] = {}
    for variation in variations:
        content = variation.content.strip()
        if not content or not 100 <= len(content) <= 3000:
            raise ValueError("invalid content")
        if variation.angle in by_angle:
            raise ValueError("duplicate angle")
        by_angle[variation.angle] = variation.model_copy(update={"content": content})
    if set(by_angle) != set(REQUIRED_ANGLES):
        raise ValueError("invalid angles")
    return [by_angle[angle] for angle in REQUIRED_ANGLES]


def _validate_citations(
    variations: Sequence[GenerationVariation],
    request: GenerationRequest,
) -> None:
    """Reject citations that are duplicated within a variation or that reference a
    chunkId outside the context supplied on this request. When context was supplied
    (a grounded request), every variation must cite at least one of those chunks;
    a citation only shows provenance for wording the model used, it is not proof that
    every claim in the variation is true."""
    context_ids = {chunk.chunk_id for chunk in request.context or []}
    grounded = bool(context_ids)
    for variation in variations:
        if len(variation.citations) != len(set(variation.citations)):
            raise ValueError("duplicate citation")
        unknown = [chunk_id for chunk_id in variation.citations if chunk_id not in context_ids]
        if unknown:
            raise ValueError("unknown citation")
        if grounded and not variation.citations:
            raise ValueError("missing citation")
        if not grounded and variation.citations:
            raise ValueError("unexpected citation")
