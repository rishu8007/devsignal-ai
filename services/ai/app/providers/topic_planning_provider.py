from collections.abc import Awaitable, Callable
from typing import Protocol

from pydantic import BaseModel

from app.providers.errors import ProviderError
from app.providers.text_prompts import TOPIC_PLANNING_SYSTEM_PROMPT
from app.schemas.common import UsageMetadata
from app.schemas.topic_planning import TopicPlanData, TopicPlanRequest


class TopicResponses(Protocol):
    async def parse(
        self, *, model: str, input: list[dict[str, str]], text_format: type[BaseModel]
    ) -> object: ...


class TopicPlanningProvider:
    def __init__(
        self,
        responses: TopicResponses,
        close_client: Callable[[], Awaitable[None]],
        model: str,
    ) -> None:
        self.responses, self.close_client, self.model = responses, close_client, model

    async def plan(self, request: TopicPlanRequest) -> TopicPlanData:
        output, _ = await self.plan_with_usage(request)
        return output

    async def plan_with_usage(
        self, request: TopicPlanRequest
    ) -> tuple[TopicPlanData, UsageMetadata | None]:
        try:
            result = await self.responses.parse(
                model=self.model,
                input=[
                    {"role": "system", "content": TOPIC_PLANNING_SYSTEM_PROMPT},
                    {"role": "user", "content": request.model_dump_json(by_alias=True)},
                ],
                text_format=TopicPlanData,
            )
        except Exception as exception:
            raise ProviderError("provider") from exception
        output = getattr(result, "output_parsed", None)
        if not isinstance(output, TopicPlanData):
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
