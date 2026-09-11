from datetime import UTC, datetime
from time import monotonic

from fastapi import APIRouter, Request

from app.schemas.health import HealthData, HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    started_at = request.app.state.started_at
    uptime_seconds = max(0, int(monotonic() - started_at))
    return HealthResponse(
        data=HealthData(
            timestamp=datetime.now(UTC),
            uptime_seconds=uptime_seconds,
        )
    )
