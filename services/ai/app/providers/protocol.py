from typing import Protocol

from app.schemas.generation import GenerationRequest, ProviderGenerationResult


class GenerationProvider(Protocol):
    async def generate(self, request: GenerationRequest) -> ProviderGenerationResult: ...

    async def close(self) -> None: ...
