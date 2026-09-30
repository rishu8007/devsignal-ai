from collections.abc import Sequence
from typing import Protocol

from app.schemas.generation import GenerationRequest, ProviderGenerationResult


class GenerationProvider(Protocol):
    async def generate(self, request: GenerationRequest) -> ProviderGenerationResult: ...

    async def close(self) -> None: ...


class EmbeddingProvider(Protocol):
    async def embed(self, texts: Sequence[str]) -> list[list[float]]: ...
