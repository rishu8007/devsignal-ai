from google.genai.errors import APIError

_REASONS_BY_STATUS = {
    400: "invalid_request",
    401: "authentication",
    403: "permission",
    404: "not_found",
    408: "request_timeout",
    429: "rate_limited",
    500: "upstream_server_error",
    502: "bad_gateway",
    503: "service_unavailable",
    504: "gateway_timeout",
}


def gemini_api_error_kind(exception: APIError) -> str:
    status = exception.code
    if status in (408, 504):
        return "timeout"
    if status == 429:
        return "rate_limit"
    if status in (401, 403, 404):
        return "unavailable"
    return "provider"


def gemini_api_error_reason(exception: APIError) -> str:
    return _REASONS_BY_STATUS.get(exception.code, "unknown")


def is_http_timeout_exception(exception: Exception) -> bool:
    return any(
        base.__name__ == "TimeoutException"
        and base.__module__.split(".", 1)[0] in {"httpx", "httpx2"}
        for base in type(exception).__mro__
    )
