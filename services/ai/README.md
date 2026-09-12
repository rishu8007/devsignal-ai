# DevSignal AI service

The FastAPI service owns prompt construction, the OpenAI provider boundary,
structured output validation, and safe AI error handling. It listens on port
`8000` by default.

For fresh-clone setup, environment variables, matching internal keys, service
URLs, and the complete verification checklist, see the
[root README](../../README.md).

## Local commands

Create the environment from the repository root, then run the service:

```powershell
py -3.14 -m venv services\ai\.venv
& services\ai\.venv\Scripts\python.exe -m pip install -e "services\ai[dev]"
& services\ai\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services\ai --reload
```

Quality checks:

```powershell
Set-Location services\ai
& .venv\Scripts\python.exe -m ruff check .
& .venv\Scripts\python.exe -m ruff format --check .
& .venv\Scripts\python.exe -m mypy app
& .venv\Scripts\python.exe -m pytest
```

The service requires `OPENAI_API_KEY`, `OPENAI_MODEL`, and an
`INTERNAL_API_KEY` of at least 32 characters. The API's
`AI_INTERNAL_API_KEY` must be identical to this internal key. The tracked
example defaults to model `gpt-5.6-luna`. Tests use a fake provider and do
not call OpenAI; live generation requires an OpenAI key and may incur usage
costs. Generated claims still require human review.

## Text chunking

The Personal RAG text chunker is a pure, deterministic service in
`app/services/chunking.py`. It currently accepts normalized user note text up
to 20,000 characters, uses a maximum of 1,000 Unicode code points per chunk,
and overlaps adjacent chunks by 150 code points. It prefers paragraph
boundaries and then whitespace boundaries near the end of each candidate
window, while preserving all other characters and reporting offsets against
the normalized LF source text.

These are character-based limits, not model-token limits. Token budgeting and
embedding-model-specific constraints will be decided later. The chunker
version is part of each output so changing its rules requires a new version
and reindexing; the logical chunk IDs are source references and are not
promised to be usable directly as Qdrant point IDs.

## Embedding provider boundary

`app/providers/embedding_provider.py` defines the typed embedding-provider
protocol and an OpenAI adapter. It reuses the lifespan-managed `AsyncOpenAI`
client and preserves the original input order using response `index` values.
It validates completeness, uniqueness, range, dimensions, finite numeric
values, and input bounds without truncating text.

The default embedding configuration is:

- `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`
- `OPENAI_EMBEDDING_DIMENSIONS=1536`
- maximum batch size: 64 texts;
- maximum text size: 1,000 Unicode code points per text;
- maximum batch size: 32,000 Unicode code points.

The model and dimensions are configured independently from the generation
`OPENAI_MODEL`. These limits are character-based safety bounds; the provider
does not silently truncate input. Provider failures are converted to safe
internal error kinds, and the existing SDK retry policy remains the only retry
layer.
