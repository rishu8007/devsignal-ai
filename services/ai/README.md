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
