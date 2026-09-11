from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import SuccessResponse


class HealthData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    service: Literal["devsignal-ai-service"] = "devsignal-ai-service"
    timestamp: datetime
    uptime_seconds: int = Field(ge=0, serialization_alias="uptimeSeconds")


HealthResponse = SuccessResponse[HealthData]
