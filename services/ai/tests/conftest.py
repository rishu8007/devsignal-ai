import os

os.environ.update(
    {
        "APP_ENV": "test",
        "HOST": "127.0.0.1",
        "PORT": "8000",
        "OPENAI_API_KEY": "test-openai-key",
        "OPENAI_MODEL": "test-model",
        "INTERNAL_API_KEY": "test-internal-key-that-is-at-least-32-characters",
        "OPENAI_TIMEOUT_SECONDS": "5",
    }
)
