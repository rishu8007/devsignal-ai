from datetime import datetime

from fastapi.testclient import TestClient

from app.main import app


def test_health() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["status"] == "ok"
    assert body["data"]["service"] == "devsignal-ai-service"
    timestamp = datetime.fromisoformat(body["data"]["timestamp"].replace("Z", "+00:00"))
    assert timestamp.tzinfo is not None
    assert timestamp.utcoffset() is not None
    assert isinstance(body["data"]["uptimeSeconds"], int)
    assert body["data"]["uptimeSeconds"] >= 0


def test_missing_route() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/missing")

    assert response.status_code == 404
    assert response.json() == {
        "success": False,
        "error": {"code": "ROUTE_NOT_FOUND", "message": "Route not found"},
    }
