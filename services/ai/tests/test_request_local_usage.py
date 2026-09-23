import asyncio
from types import SimpleNamespace

from app.providers.embedding_provider import OpenAIEmbeddingProvider


class InterleavedEmbeddings:
    def __init__(self) -> None:
        self.started: list[asyncio.Future[None]] = []
        self.calls = 0

    async def create(self, **kwargs):
        self.calls += 1
        call_number = self.calls
        gate = asyncio.get_running_loop().create_future()
        self.started.append(gate)
        if self.calls == 2:
            self.started[0].set_result(None)
            gate.set_result(None)
        await gate
        return SimpleNamespace(
            usage=SimpleNamespace(prompt_tokens=10 if call_number == 1 else None),
            data=[SimpleNamespace(index=0, embedding=[0.0] * kwargs["dimensions"])],
        )


def test_embedding_usage_is_request_local_when_calls_interleave() -> None:
    async def run() -> None:
        api = InterleavedEmbeddings()
        provider = OpenAIEmbeddingProvider(api, dimensions=2)
        first, second = await asyncio.gather(
            provider.embed_with_usage(["first"]),
            provider.embed_with_usage(["second"]),
        )
        assert first[1] is not None
        assert first[1].embedding_tokens == 10
        assert second[1] is not None
        assert second[1].embedding_tokens is None

    asyncio.run(run())
