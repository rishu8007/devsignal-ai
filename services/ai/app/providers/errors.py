class ProviderError(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)


class EmbeddingProviderError(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)
