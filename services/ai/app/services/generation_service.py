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
