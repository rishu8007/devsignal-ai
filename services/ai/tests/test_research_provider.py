import asyncio

import pytest

from app.providers.openai_provider import ProviderError
from app.providers.research_brief_provider import ResearchBriefProvider
from app.schemas.research_brief import ResearchBriefRequest


class FailingResponses:
    def __init__(self) -> None:
        self.calls = 0

    async def parse(self, **_kwargs: object) -> object:
        self.calls += 1
        raise RuntimeError("provider failure")


def test_research_provider_does_not_retry_after_provider_failure() -> None:
    responses = FailingResponses()
    provider = ResearchBriefProvider(responses, _close, "test-model")
    request = ResearchBriefRequest(
        topic="Topic",
        notes="This is a sufficiently detailed set of signal notes.",
        evidence=[],
    )

    with pytest.raises(ProviderError):
        asyncio.run(provider.research(request))

    assert responses.calls == 1


async def _close() -> None:
    return None
