import asyncio

import pytest

from app.providers.draft_review_provider import DraftReviewProvider
from app.providers.openai_provider import ProviderError
from app.schemas.draft_review import DraftReviewRequest


class FailingResponses:
    def __init__(self) -> None:
        self.calls = 0

    async def parse(self, **_kwargs: object) -> object:
        self.calls += 1
        raise RuntimeError("provider failure")


def test_draft_review_provider_does_not_retry_after_failure() -> None:
    responses = FailingResponses()
    provider = DraftReviewProvider(responses, _close, "test-model")
    request = DraftReviewRequest(
        draft=(
            "This draft contains enough content to satisfy the bounded review request "
            "and provide a realistic passage for the technical reviewer."
        ),
        evidence=[],
    )

    with pytest.raises(ProviderError):
        asyncio.run(provider.review(request))

    assert responses.calls == 1


async def _close() -> None:
    return None
