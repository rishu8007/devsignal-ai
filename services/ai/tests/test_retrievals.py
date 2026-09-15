from dataclasses import dataclass

from fastapi.testclient import TestClient

from app.main import app
from app.services.retrieval import RetrievalCandidate, RetrievalError

INTERNAL_KEY = "test-internal-key-that-is-at-least-32-characters"
PAYLOAD = {
    "ownerId": "507f1f77bcf86cd799439011",
    "query": "deployment notes",
    "limit": 5,
}


@dataclass
class FakeRetrievalService:
    error: RetrievalError | None = None

    async def retrieve(self, owner_id: str, query: str, limit: int) -> list[RetrievalCandidate]:
        assert owner_id == PAYLOAD["ownerId"]
        assert query == PAYLOAD["query"]
        assert limit == PAYLOAD["limit"]
        if self.error:
            raise self.error
        return [
            RetrievalCandidate(
                point_id="point-id",
                source_id="507f1f77bcf86cd799439012",
                content_version=2,
                chunker_version="text-v1",
                chunk_index=0,
                chunk_id="507f1f77bcf86cd799439012_v2_c0",
                text="deployment notes",
                start_offset=0,
                end_offset=16,
                embedding_model="text-embedding-3-small",
                score=0.91,
            )
        ]


def client_with(service: FakeRetrievalService) -> TestClient:
    client = TestClient(app)
    client.__enter__()
    app.state.retrieval_service = service
    return client


def test_retrieval_requires_internal_authentication() -> None:
    client = client_with(FakeRetrievalService())
    try:
        response = client.post("/api/v1/retrievals", json=PAYLOAD)
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 401


def test_retrieval_rejects_unknown_fields() -> None:
    client = client_with(FakeRetrievalService())
    try:
        response = client.post(
            "/api/v1/retrievals",
            json={**PAYLOAD, "vectors": True},
            headers={"X-Internal-API-Key": INTERNAL_KEY},
        )
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_retrieval_returns_candidates_without_vectors() -> None:
    client = client_with(FakeRetrievalService())
    try:
        response = client.post(
            "/api/v1/retrievals",
            json=PAYLOAD,
            headers={"X-Internal-API-Key": INTERNAL_KEY},
        )
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 200
    candidate = response.json()["data"][0]
    assert candidate["sourceId"] == "507f1f77bcf86cd799439012"
    assert "vector" not in candidate


def test_retrieval_distinguishes_missing_collection() -> None:
    client = client_with(FakeRetrievalService(RetrievalError("collection_missing")))
    try:
        response = client.post(
            "/api/v1/retrievals",
            json=PAYLOAD,
            headers={"X-Internal-API-Key": INTERNAL_KEY},
        )
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "RETRIEVAL_COLLECTION_MISSING"
