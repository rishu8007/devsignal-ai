# DevSignal AI Service

## Local setup

```powershell
py -3.14 -m venv services\ai\.venv
& services\ai\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e "services\ai[dev]"
```

Copy `.env.example` to a private `services\ai\.env` and replace every
placeholder. Required settings include `OPENAI_API_KEY` and
`INTERNAL_API_KEY` (at least 32 characters). The configured default model in
`.env.example` is `gpt-5.6-luna`; the response reports the model returned by
the provider. Never commit or share secrets.

## Generation endpoint

The internal generation endpoint requires:

```text
X-Internal-API-Key: <the INTERNAL_API_KEY value>
```

Example request:

```powershell
$headers = @{ "X-Internal-API-Key" = "your-private-internal-key" }
$body = @{
  topic = "Connecting my Next.js dashboard to an authenticated API"
  notes = "I connected the dashboard form to an authenticated Express API and verified the flow."
  primaryAudience = "Developers & engineers"
  contentType = "Build in public"
} | ConvertTo-Json
Invoke-WebRequest http://127.0.0.1:8000/api/v1/generations -Method Post -Headers $headers -Body $body -ContentType "application/json"
```

Automated tests use a fake provider and never call OpenAI. Structured
validation checks response shape, angles and lengths; it cannot prove factual
accuracy. Generated drafts must be reviewed by a human before publication.

## Quality checks

```powershell
ruff check services\ai
ruff format --check services\ai
mypy services\ai\app
pytest services\ai\tests
```

## Run locally

```powershell
uvicorn app.main:app --app-dir services\ai --reload
Invoke-WebRequest http://127.0.0.1:8000/api/v1/health
```
