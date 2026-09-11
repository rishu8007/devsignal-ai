from collections.abc import Awaitable, Callable, Sequence
from typing import Protocol

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    RateLimitError,
)

from app.prompts import SYSTEM_PROMPT, build_user_prompt
from app.schemas.generation import (
    GenerationRequest,
    ProviderGenerationOutput,
    ProviderGenerationResult,
)


class ParsedResponse(Protocol):
    output_parsed: ProviderGenerationOutput | None
    output: Sequence[object]
    model: str | None


class ResponsesAPI(Protocol):
    async def parse(
        self,
        *,
        model: str,
        input: list[dict[str, str]],
        text_format: type[ProviderGenerationOutput],
    ) -> ParsedResponse: ...


class ProviderError(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)


class OpenAIProvider:
    def __init__(
        self,
        responses: ResponsesAPI,
        close_client: Callable[[], Awaitable[None]],
        model: str,
    ) -> None:
        self._responses = responses
        self._close_client = close_client
        self._model = model

    async def generate(self, request: GenerationRequest) -> ProviderGenerationResult:
        try:
            response = await self._responses.parse(
                model=self._model,
                input=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": build_user_prompt(request)},
                ],
                text_format=ProviderGenerationOutput,
            )
        except APITimeoutError as exception:
            raise ProviderError("timeout") from exception
        except RateLimitError as exception:
            raise ProviderError("rate_limit") from exception
        except AuthenticationError as exception:
            raise ProviderError("unavailable") from exception
        except (APIConnectionError, APIStatusError) as exception:
            raise ProviderError("provider") from exception

        if _response_refused(response):
            raise ProviderError("refused")
        if response.output_parsed is None or not response.model:
            raise ProviderError("invalid_response")
        return ProviderGenerationResult(output=response.output_parsed, model=response.model)

    async def close(self) -> None:
        await self._close_client()


def _response_refused(response: ParsedResponse) -> bool:
    for item in response.output:
        for content in _content_items(item):
            if _refusal_text(content) is not None:
                return True
    return False


def _content_items(item: object) -> Sequence[object]:
    content = getattr(item, "content", None)
    if isinstance(content, Sequence) and not isinstance(content, (str, bytes)):
        return content
    return ()


def _refusal_text(content: object) -> str | None:
    refusal = getattr(content, "refusal", None)
    return refusal if isinstance(refusal, str) and refusal else None
