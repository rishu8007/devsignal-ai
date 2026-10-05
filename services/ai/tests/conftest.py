import os

os.environ.update(
    {
        "APP_ENV": "test",
        "HOST": "127.0.0.1",
        "PORT": "8000",
        "GEMINI_API_KEY": "test-gemini-key",
        "GEMINI_MODEL": "test-model",
        "INTERNAL_API_KEY": "test-internal-key-that-is-at-least-32-characters",
        "GEMINI_TIMEOUT_SECONDS": "5",
        "QDRANT_COLLECTION_NAME": "devsignal_knowledge_chunks_gemini_v1",
    }
)
