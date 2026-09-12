# DevSignal AI

DevSignal AI turns a developer's work into human-reviewed personal-brand
content. The current product includes:

- authenticated Signals with notes, audience, and content type;
- three AI-generated draft variations;
- draft editing and approval;
- an owner-scoped draft library;
- plain-text copying;
- a manual content calendar with planned dates.

Nothing publishes automatically. Automatic publishing and notifications are
future plans, not implemented features.

## Architecture

| Area | Location | Responsibility |
| --- | --- | --- |
| Web | `apps/web` | Next.js dashboard and browser interaction |
| API | `services/api` | Express authentication, ownership, MongoDB, drafts, approval, scheduling, and AI-service calls |
| AI service | `services/ai` | FastAPI prompt/provider boundary and structured output validation |
| Shared packages | `packages/*` | Reserved for shared TypeScript contracts |

## Prerequisites

- Windows PowerShell
- Docker Desktop with Compose
- Node.js 22 or newer; CI uses Node 22. Local development was verified with Node 24.
- Python 3.14; use the project virtual environment at `services\ai\.venv`

The root `package-lock.json` is authoritative for JavaScript dependencies.
The AI service currently uses `pyproject.toml` editable installation; no
Python lockfile is committed.

## Fresh-clone setup

Run these commands from `D:\devsignal-ai` in PowerShell:

```powershell
npm ci

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
}
if (-not (Test-Path services\api\.env)) {
  Copy-Item services\api\.env.example services\api\.env
}
if (-not (Test-Path apps\web\.env.local)) {
  Copy-Item apps\web\.env.example apps\web\.env.local
}
if (-not (Test-Path services\ai\.env)) {
  Copy-Item services\ai\.env.example services\ai\.env
}

py -3.14 -m venv services\ai\.venv
& services\ai\.venv\Scripts\python.exe -m pip install --upgrade pip
& services\ai\.venv\Scripts\python.exe -m pip install -e "services\ai[dev]"
```

Replace placeholders in the private environment files before starting
services. Never commit them.

The root `.env` is used by Docker Compose. Set
`MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, and optionally `MONGO_PORT`,
then start MongoDB:

```powershell
docker compose up -d mongo
docker compose ps
```

Start each service in a separate PowerShell terminal from the repository root:

```powershell
# Terminal 1: Express API at http://127.0.0.1:4000
npm run dev:api

# Terminal 2: FastAPI AI service at http://127.0.0.1:8000
& services\ai\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services\ai --reload

# Terminal 3: Next.js web app at http://localhost:3000
npm run dev:web
```

Use the same host style for browser and API configuration:
`apps/web/.env.local` uses `http://localhost:4000/api/v1`, while the API
example uses `WEB_ORIGIN=http://localhost:3000`. This keeps browser cookie
sessions same-site and predictable. If you use `127.0.0.1`, use it
consistently for both sides instead.

## Environment configuration

Create files only from the tracked examples. The required values are:

- Root `.env`: `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, and optional
  `MONGO_PORT` for Compose.
- `services/api/.env`: `NODE_ENV`, `PORT`, `WEB_ORIGIN`, `MONGODB_URI`,
  `JWT_ACCESS_SECRET` (at least 32 characters), JWT issuer/audience/TTL,
  `AUTH_COOKIE_NAME`, `AI_SERVICE_URL`, matching `AI_INTERNAL_API_KEY`, and
  `AI_SERVICE_TIMEOUT_MS`.
- `services/ai/.env`: `APP_ENV`, `HOST`, `PORT`, `OPENAI_API_KEY`,
  `OPENAI_MODEL`, matching `INTERNAL_API_KEY` (at least 32 characters), and
  `OPENAI_TIMEOUT_SECONDS`.
- `apps/web/.env.local`: `NEXT_PUBLIC_API_BASE_URL`.

`services/api/.env` and `services/ai/.env` must use the same internal key:
the API sends `AI_INTERNAL_API_KEY` and FastAPI verifies `INTERNAL_API_KEY`.
The examples use `gpt-5.6-luna` as the AI model default. Live generation
requires a valid OpenAI key and can incur provider usage costs. Tests use a
fake provider and do not call OpenAI.

## Verification

Health checks:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/api/v1/health
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health
```

JavaScript checks from the repository root:

```powershell
npm run lint --workspace=apps/web
npm run build --workspace=apps/web
npm run typecheck --workspace=services/api
npm run build --workspace=services/api
npm test --workspace=services/api
```

AI checks (run from `services\ai` so its project configuration is applied):

```powershell
Push-Location services\ai
try {
  & .venv\Scripts\python.exe -m ruff check .
  & .venv\Scripts\python.exe -m ruff format --check .
  & .venv\Scripts\python.exe -m mypy app
  & .venv\Scripts\python.exe -m pytest
} finally {
  Pop-Location
}
```

CI runs these checks in separate web, API, and AI jobs. CI uses harmless
placeholders, mocked AI tests, and no MongoDB service container; a hosted
workflow result is distinct from these local checks.

## Current limitations

- Calendar dates are manual publishing plans; nothing publishes automatically.
- Editing scheduled approved content clears both approval and its planned date.
- The Scheduled metric counts approved variations with a planned date,
  including past planned dates, until they are removed.
- Generated claims may be unsupported and must be checked by a human before use.
- The API's in-memory generation guard coordinates one API process only;
  distributed coordination is a future deployment concern.

See [services/api/README.md](services/api/README.md) and
[services/ai/README.md](services/ai/README.md) for service-specific details.
