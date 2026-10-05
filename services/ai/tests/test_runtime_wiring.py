import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from app import main
from app.config import Settings
from app.providers.gemini_embedding_provider import GeminiEmbeddingProvider
from app.providers.gemini_provider import (
    GeminiDraftReviewProvider,
    GeminiGenerationProvider,
    GeminiResearchBriefProvider,
    GeminiTopicPlanningProvider,
)


def settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "_env_file": None,
        "gemini_api_key": "test-gemini-key",
        "internal_api_key": "test-internal-key-that-is-at-least-32-characters",
    }
    values.update(overrides)
    return Settings(**values)


class FakeAsyncClient:
    def __init__(self) -> None:
        self.models = SimpleNamespace()
        self.close_calls = 0

    async def aclose(self) -> None:
        self.close_calls += 1


class FakeGenaiClient:
    last_client: FakeAsyncClient | None = None

    def __init__(self, **_kwargs: Any) -> None:
        self.aio = FakeAsyncClient()
        FakeGenaiClient.last_client = self.aio


def test_settings_require_gemini_key_without_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_EMBEDDING_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_EMBEDDING_DIMENSIONS", raising=False)
    monkeypatch.delenv("QDRANT_COLLECTION_NAME", raising=False)
    configured = settings()
    assert configured.gemini_api_key.get_secret_value() == "test-gemini-key"
    assert configured.gemini_model == "gemini-3.8-flash"
    assert configured.gemini_embedding_model == "gemini-embedding-2"
    assert configured.qdrant_collection_name == "devsignal_knowledge_chunks_gemini_v1"

    with pytest.raises(ValidationError):
        settings(gemini_api_key="")


def test_legacy_openai_collection_is_rejected() -> None:
    with pytest.raises(ValidationError):
        settings(qdrant_collection_name="devsignal_knowledge_chunks")


def test_lifespan_wires_gemini_adapters_and_closes_shared_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main.genai, "Client", FakeGenaiClient)
    monkeypatch.setattr(main, "get_settings", lambda: settings())

    async def exercise() -> None:
        async with main.lifespan(main.app):
            assert isinstance(main.app.state.provider, GeminiGenerationProvider)
            assert isinstance(main.app.state.topic_planning_provider, GeminiTopicPlanningProvider)
            assert isinstance(main.app.state.research_brief_provider, GeminiResearchBriefProvider)
            assert isinstance(main.app.state.draft_review_provider, GeminiDraftReviewProvider)
            assert isinstance(main.app.state.embedding_provider, GeminiEmbeddingProvider)
            assert main.app.state.research_embedding_provider is main.app.state.embedding_provider
            assert main.app.state.indexing_service._embedding_configuration.model == (
                "gemini-embedding-2"
            )
            assert main.app.state.retrieval_service._embedding_configuration.dimensions == 1536
            assert main.app.state.research_retrieval_service._embedding_configuration.model == (
                "gemini-embedding-2"
            )
            assert main.app.state.workflow_graph is None

        assert FakeGenaiClient.last_client is not None
        assert FakeGenaiClient.last_client.close_calls == 1

    asyncio.run(exercise())


def test_partial_startup_closes_gemini_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main.genai, "Client", FakeGenaiClient)
    monkeypatch.setattr(main, "get_settings", lambda: settings())

    class FailingRepository:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise RuntimeError("qdrant setup failed")

    monkeypatch.setattr(main, "QdrantVectorRepository", FailingRepository)

    async def exercise() -> None:
        with pytest.raises(RuntimeError, match="qdrant setup failed"):
            async with main.lifespan(main.app):
                pass
        assert FakeGenaiClient.last_client is not None
        assert FakeGenaiClient.last_client.close_calls == 1

    asyncio.run(exercise())


def test_optional_workflow_uses_gemini_generation_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main.genai, "Client", FakeGenaiClient)
    monkeypatch.setattr(
        main,
        "get_settings",
        lambda: settings(workflow_checkpoint_uri="mongodb://workflow-test"),
    )
    captured: dict[str, object] = {}
    workflow_graph = object()

    class FakeMongoClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        def close(self) -> None:
            pass

    class FakeCheckpointer:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        def close(self) -> None:
            pass

    def fake_build_workflow_graph(
        research_provider: object,
        generation_provider: object,
        review_provider: object,
        checkpointer: object,
    ) -> object:
        captured.update(
            research=research_provider,
            generation=generation_provider,
            review=review_provider,
            checkpointer=checkpointer,
        )
        return workflow_graph

    monkeypatch.setattr(main, "MongoClient", FakeMongoClient)
    monkeypatch.setattr(main, "MongoDBSaver", FakeCheckpointer)
    monkeypatch.setattr(main, "build_workflow_graph", fake_build_workflow_graph)

    async def exercise() -> None:
        async with main.lifespan(main.app):
            assert isinstance(captured["generation"], GeminiGenerationProvider)
            assert isinstance(captured["research"], GeminiResearchBriefProvider)
            assert isinstance(captured["review"], GeminiDraftReviewProvider)
            assert main.app.state.workflow_graph is workflow_graph

    asyncio.run(exercise())
