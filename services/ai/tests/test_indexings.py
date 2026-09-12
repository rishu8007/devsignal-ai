from dataclasses import dataclass

from fastapi.testclient import TestClient

from app.main import app
from app.services.source_indexing import (
    SourceIndexingError,
    SourceIndexingInput,
    SourceIndexingResult,
)

INTERNAL_KEY = "test-internal-key-that-is-at-least-32-characters"
PAYLOAD = {
    "ownerId": "507f1f77bcf86cd799439011",
    "sourceId": "507f1f77bcf86cd799439012",
    "contentVersion": 1,
    "content": "A sufficiently long source note for indexing.",
}


@dataclass
class FakeIndexingService:
    error: SourceIndexingError | None = None

    async def index(self, request: SourceIndexingInput) -> SourceIndexingResult:
        if self.error:
            raise self.error
        return SourceIndexingResult(
            source_id=request.source_id,
            content_version=request.content_version,
            chunker_version="chunker-v1",
            embedding_model="text-embedding-3-small",
            dimensions=1536,
            indexed_chunk_count=1,
        )


def client_with(service: FakeIndexingService) -> TestClient:
    client = TestClient(app)
    client.__enter__()
    app.state.indexing_service = service
    return client


def test_indexing_requires_internal_authentication() -> None:
    client = client_with(FakeIndexingService())
    try:
        response = client.post("/api/v1/indexings", json=PAYLOAD)
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SERVICE_AUTHENTICATION_REQUIRED"


def test_indexing_rejects_unknown_fields() -> None:
    client = client_with(FakeIndexingService())
    try:
        response = client.post(
            "/api/v1/indexings",
            json={**PAYLOAD, "owner": "not-allowed"},
            headers={"X-Internal-API-Key": INTERNAL_KEY},
        )
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_indexing_returns_metadata_only_success() -> None:
    client = client_with(FakeIndexingService())
    try:
        response = client.post(
            "/api/v1/indexings",
            json=PAYLOAD,
            headers={"X-Internal-API-Key": INTERNAL_KEY},
        )
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "data": {
            "sourceId": PAYLOAD["sourceId"],
            "contentVersion": 1,
            "chunkerVersion": "chunker-v1",
            "embeddingModel": "text-embedding-3-small",
            "dimensions": 1536,
            "indexedChunkCount": 1,
        },
    }


def test_indexing_maps_failures_to_safe_contract() -> None:
    client = client_with(FakeIndexingService(SourceIndexingError("timeout")))
    try:
        response = client.post(
            "/api/v1/indexings",
            json=PAYLOAD,
            headers={"X-Internal-API-Key": INTERNAL_KEY},
        )
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 504
    assert response.json()["error"] == {
        "code": "INDEXING_TIMEOUT",
        "message": "Knowledge source indexing failed",
    }
