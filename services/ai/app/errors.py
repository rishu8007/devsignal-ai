from dataclasses import dataclass


@dataclass(frozen=True)
class ApplicationError(Exception):
    status_code: int
    code: str
    message: str

    def error_body(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


SERVICE_AUTHENTICATION_ERROR = ApplicationError(
    401,
    "SERVICE_AUTHENTICATION_REQUIRED",
    "Service authentication is required",
)
