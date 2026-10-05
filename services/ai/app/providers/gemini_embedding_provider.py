from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Protocol

import httpx
from google.genai import types
from google.genai.errors import APIError

from app.providers.embedding_provider import (
    _validate_input_texts,
    _validate_vector,
)
from app.providers.errors import EmbeddingProviderError
from app.providers.gemini_errors import gemini_api_error_kind, is_http_timeout_exception
from app.providers.protocol import EmbeddingPurpose
from app.schemas.common import UsageMetadata

GEMINI_EMBEDDING_MODEL = "gemini-embedding-2"
GEMINI_EMBEDDING_DIMENSIONS = 1536
GEMINI_MAX_EMBEDDING_BATCH_CODE_POINTS = 32_000
GEMINI_EMBEDDING_TIMEOUT_SECONDS = 45


class GeminiEmbeddingModels(Protocol):
    async def embed_content(
        self,
        *,
        model: str,
        contents: list[types.Content],
        config: types.EmbedContentConfig,
    ) -> object: ...


class GeminiEmbeddingClient(Protocol):
    models: GeminiEmbeddingModels


class GeminiEmbeddingProvider:
    """Gemini embedding adapter using a borrowed, lifespan-managed async client.

    The adapter never closes the injected client. The application lifecycle owns it
    and must close it once after all text and embedding adapters have stopped using it.
    """

    def __init__(
        self,
        client: GeminiEmbeddingClient,
        model: str = GEMINI_EMBEDDING_MODEL,
        dimensions: int = GEMINI_EMBEDDING_DIMENSIONS,
        timeout_seconds: float = GEMINI_EMBEDDING_TIMEOUT_SECONDS,
    ) -> None:
        if not model.strip():
            raise ValueError("model must not be blank")
        if dimensions < 1:
            raise ValueError("dimensions must be positive")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self._client = client
        self._model = model
        self._dimensions = dimensions
        self._timeout_seconds = timeout_seconds

    async def embed(
        self,
        texts: Sequence[str],
        *,
        purpose: EmbeddingPurpose = "document",
    ) -> list[list[float]]:
        vectors, _ = await self.embed_with_usage(texts, purpose=purpose)
        return vectors

    async def embed_with_usage(
        self,
        texts: Sequence[str],
        *,
        purpose: EmbeddingPurpose = "document",
    ) -> tuple[list[list[float]], UsageMetadata | None]:
        input_texts = list(texts)
        _validate_input_texts(input_texts)
        if purpose not in ("document", "query"):
            raise ValueError("Unknown embedding purpose")
        if sum(map(len, input_texts)) > GEMINI_MAX_EMBEDDING_BATCH_CODE_POINTS:
            raise ValueError("Embedding batch input is too large")

        contents = [
            types.Content(parts=[types.Part(text=_format_embedding_input(text, purpose))])
            for text in input_texts
        ]
        config = types.EmbedContentConfig(
            output_dimensionality=self._dimensions,
            http_options=types.HttpOptions(
                timeout=int(self._timeout_seconds * 1000),
                retry_options=types.HttpRetryOptions(
                    attempts=1,
                    http_status_codes=[],
                ),
            ),
        )

        try:
            response = await self._client.models.embed_content(
                model=self._model,
                contents=contents,
                config=config,
            )
        except asyncio.CancelledError:
            raise
        except (httpx.TimeoutException, TimeoutError) as exception:
            raise EmbeddingProviderError("timeout") from exception
        except APIError as exception:
            raise EmbeddingProviderError(gemini_api_error_kind(exception)) from exception
        except httpx.TransportError as exception:
            raise EmbeddingProviderError("provider") from exception
        except Exception as exception:
            kind = "timeout" if is_http_timeout_exception(exception) else "provider"
            raise EmbeddingProviderError(kind) from exception

        embeddings = getattr(response, "embeddings", None)
        if (
            not isinstance(embeddings, Sequence)
            or isinstance(embeddings, (str, bytes))
            or len(embeddings) != len(input_texts)
        ):
            raise EmbeddingProviderError("invalid_response")

        vectors = [
            _validate_vector(getattr(embedding, "values", None), self._dimensions)
            for embedding in embeddings
        ]
        usage = _usage_metadata(embeddings, self._model)
        return vectors, usage


def _format_embedding_input(text: str, purpose: EmbeddingPurpose) -> str:
    if purpose == "query":
        return f"task: search result | query: {text}"
    return f"title: none | text: {text}"


def _usage_metadata(embeddings: Sequence[object], model: str) -> UsageMetadata | None:
    token_counts: list[int] = []
    for embedding in embeddings:
        statistics = getattr(embedding, "statistics", None)
        count = getattr(statistics, "token_count", None)
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            return None
        token_counts.append(count)
    return UsageMetadata(model=model, embeddingTokens=sum(token_counts))
