import secrets
from typing import cast

from fastapi import Header, Request

from app.config import get_settings
from app.errors import SERVICE_AUTHENTICATION_ERROR
from app.providers.protocol import GenerationProvider


def require_internal_api_key(
    request: Request, x_internal_api_key: str | None = Header(default=None)
) -> GenerationProvider:
    expected = get_settings().internal_api_key.get_secret_value().encode("utf-8")
    provided = (x_internal_api_key or "").encode("utf-8")
    if not secrets.compare_digest(expected, provided):
        raise SERVICE_AUTHENTICATION_ERROR
    return cast(GenerationProvider, request.app.state.provider)
