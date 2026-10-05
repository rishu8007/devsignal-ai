class ProviderError(Exception):
    def __init__(
        self,
        kind: str,
        *,
        exception_class: str | None = None,
        stage: str | None = None,
        upstream_status: int | None = None,
        reason: str | None = None,
    ) -> None:
        self.kind = kind
        self.exception_class = exception_class
        self.stage = stage
        self.upstream_status = upstream_status
        self.reason = reason
        super().__init__(kind)


class EmbeddingProviderError(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)
