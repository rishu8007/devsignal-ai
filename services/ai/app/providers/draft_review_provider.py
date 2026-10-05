from collections.abc import Awaitable, Callable
from typing import Protocol

from pydantic import BaseModel

from app.providers.errors import ProviderError
from app.providers.text_prompts import DRAFT_REVIEW_SYSTEM_PROMPT
from app.schemas.common import UsageMetadata
from app.schemas.draft_review import DraftReviewData, DraftReviewRequest


class ReviewResponses(Protocol):
    async def parse(
        self,
        *,
        model: str,
        input: list[dict[str, str]],
        text_format: type[BaseModel],
    ) -> object: ...


class DraftReviewProvider:
    def __init__(
        self,
        responses: ReviewResponses,
        close_client: Callable[[], Awaitable[None]],
        model: str,
    ) -> None:
        self.responses, self.close_client, self.model = responses, close_client, model

    async def review(self, request: DraftReviewRequest) -> DraftReviewData:
        output, _ = await self.review_with_usage(request)
        return output

    async def review_with_usage(
        self, request: DraftReviewRequest
    ) -> tuple[DraftReviewData, UsageMetadata | None]:
        try:
            result = await self.responses.parse(
                model=self.model,
                input=[
                    {"role": "system", "content": DRAFT_REVIEW_SYSTEM_PROMPT},
                    {"role": "user", "content": request.model_dump_json(by_alias=True)},
                ],
                text_format=DraftReviewData,
            )
        except Exception as exception:
            raise ProviderError("provider") from exception
        output = getattr(result, "output_parsed", None)
        if not isinstance(output, DraftReviewData):
            raise ProviderError("invalid_response")
        usage = getattr(result, "usage", None)
        usage_metadata = (
            UsageMetadata(
                model=self.model,
                inputTokens=getattr(usage, "input_tokens", None),
                outputTokens=getattr(usage, "output_tokens", None),
            )
            if usage is not None
            else None
        )
        return output, usage_metadata

    async def close(self) -> None:
        await self.close_client()
