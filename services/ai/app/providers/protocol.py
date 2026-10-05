from collections.abc import Sequence
from typing import Literal, Protocol

from app.schemas.generation import GenerationRequest, ProviderGenerationResult


class GenerationProvider(Protocol):
    async def generate(self, request: GenerationRequest) -> ProviderGenerationResult: ...

    async def close(self) -> None: ...


EmbeddingPurpose = Literal["document", "query"]


class EmbeddingProvider(Protocol):
    async def embed(
        self,
        texts: Sequence[str],
        *,
        purpose: EmbeddingPurpose = "document",
    ) -> list[list[float]]: ...
