# DevSignal AI

DevSignal AI turns a developer's work into human-reviewed personal-brand
content. The current product includes:

- authenticated Signals with notes, audience, and content type;
- three AI-generated draft variations;
- draft editing and approval;
- an owner-scoped draft library;
- plain-text copying;
- a manual content calendar with planned dates.
- Personal Knowledge notes that can be explicitly indexed and used as
  opt-in supporting context for new draft Generations;
- per-variation supporting references with read-only inspection of the
  current source.

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
`MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, and optionally `MONGO_PORT` or
`QDRANT_PORT`, then start the local databases:

```powershell
docker compose up -d mongo
docker compose up -d qdrant
docker compose ps
```

Qdrant is available at `http://127.0.0.1:6333` by default and persists data
in the named `devsignal_qdrant_data` volume. Its Compose service has no
curl/wget-based healthcheck; verify it from the AI virtual environment with
the Qdrant client:

```powershell
Push-Location services\ai
try {
  @'
import asyncio
from qdrant_client import AsyncQdrantClient

async def check():
    client = AsyncQdrantClient(url="http://127.0.0.1:6333")
    print(await client.get_collections())
    await client.close()

asyncio.run(check())
'@ | & .venv\Scripts\python.exe -
} finally {
  Pop-Location
}
```

If `QDRANT_PORT` is changed from `6333`, set `QDRANT_URL` in
`services\ai\.env` to the same localhost port.

The vector collection is not created during service startup. Collection
initialization will be part of the later indexing workflow.

The API's `MONGODB_URI` must use the same username and password as the root
Compose variables. The tracked API example demonstrates the local shape:
`mongodb://<username>:<password>@127.0.0.1:27017/devsignal?authSource=admin`.
`authSource=admin` is required because Compose creates the root user in
MongoDB's `admin` authentication database, even though the application
database is `devsignal`. If a username or password contains reserved URI
characters such as `@`, `:`, `/`, `?`, or `#`, percent-encode that credential
before placing it in `MONGODB_URI`; do not copy the raw value into the URI.
The MongoDB initialization credentials apply when the data volume is first
created. Changing the root `.env` later does not rotate an existing database
user.

Start each service in a separate PowerShell terminal from the repository root:

```powershell
# Terminal 1: Express API at http://127.0.0.1:4000
npm run dev:api

# Terminal 2: FastAPI AI service at http://127.0.0.1:8000
& services\ai\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services\ai --reload

# Terminal 3: Next.js web app at http://localhost:3000
npm run dev:web
```

Run exactly one AI service on port 8000. The `--reload` option watches the
current `services\ai` code and restarts Uvicorn after local code changes; it
does not require or justify starting a second server. If port 8000 is already
occupied, reuse the healthy service or stop that specific local process before
starting another one. Do not run duplicate AI servers against the same API
configuration.

Use the same host style for browser and API configuration:
`apps/web/.env.local` uses `http://localhost:4000/api/v1`, while the API
example uses `WEB_ORIGIN=http://localhost:3000`. This keeps browser cookie
sessions same-site and predictable. If you use `127.0.0.1`, use it
consistently for both sides instead.

## Optional Docker application stack

The default Compose file still starts only the existing MongoDB and Qdrant
infrastructure. The web, API, and AI containers are opt-in through the
`app` profile and reuse the existing named volumes; they do not reset or
migrate existing data.

Create a private full-stack environment file from the placeholder example,
then validate and start the application profile from the repository root:

```powershell
Copy-Item .env.docker.example .env.docker
# Edit .env.docker and replace every placeholder, including both service keys.
docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app config --quiet
docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app build
docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app up -d
docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app ps
```

The browser uses `NEXT_PUBLIC_API_BASE_URL` baked into the web image at build
time and must use a browser-reachable URL such as
`http://localhost:4000/api/v1`; container DNS names such as `http://api:4000`
must not be used there. API-to-MongoDB, API-to-AI, and AI-to-Qdrant use
Compose service names internally. If a directly running service already owns
ports 3000, 4000, or 8000, choose unused `WEB_PORT`, `API_PORT`, or `AI_PORT`
values and update `NEXT_PUBLIC_API_BASE_URL`/`WEB_ORIGIN` consistently, or
stop that specific process deliberately. Do not kill arbitrary processes.

Check the bounded HTTP health endpoints without invoking providers:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/api/v1/health
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health
Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing
```

After source changes, rebuild the affected image. Rebuild the web image after
code or any `NEXT_PUBLIC_*` value changes; recreate API or AI containers after
server-side environment changes:

```powershell
docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app up -d --build web
docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app up -d --force-recreate api ai
```

For recovery, inspect status and bounded logs, then restart only the affected
service after correcting its configuration:

```powershell
docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app ps
docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app logs --tail 100 web api ai
docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app up -d --no-deps api
docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app stop
```

`docker compose -f docker-compose.yml -f docker-compose.app.yml --env-file .env.docker --profile app stop` preserves containers and volumes; do not use
`docker compose down -v`, volume prune, or database migrations in the normal
workflow. A healthy HTTP endpoint confirms process readiness only; it does
not prove OpenAI credentials, Qdrant collections, indexing, retrieval, or
generation work.

Optional manual login and Knowledge/search/generation smoke checks can be
performed at `http://localhost:3000` after health checks. Saving/indexing
notes, retrieval, and generation may call paid providers. This local Compose
setup is not a hosted production deployment; hosted HTTPS requires reviewing
the browser/API origin and secure-cookie configuration separately.

## Environment configuration

Create files only from the tracked examples. The required values are:

- Root `.env`: `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, and optional
  `MONGO_PORT` for Compose.
- `services/api/.env`: `NODE_ENV`, `PORT`, `WEB_ORIGIN`, `MONGODB_URI`,
  `JWT_ACCESS_SECRET` (at least 32 characters), JWT issuer/audience/TTL,
  `AUTH_COOKIE_NAME`, `AI_SERVICE_URL`, matching `AI_INTERNAL_API_KEY`, and
  `AI_SERVICE_TIMEOUT_MS`.
- `services/ai/.env`: `APP_ENV`, `HOST`, `PORT`, `OPENAI_API_KEY`,
  `OPENAI_MODEL`, embedding model/dimensions, `QDRANT_URL`,
  `QDRANT_COLLECTION_NAME`, `QDRANT_TIMEOUT_SECONDS`, matching
  `INTERNAL_API_KEY` (at least 32 characters), and `OPENAI_TIMEOUT_SECONDS`.
- `apps/web/.env.local`: `NEXT_PUBLIC_API_BASE_URL`.

`services/api/.env` and `services/ai/.env` must use the same internal key:
the API sends `AI_INTERNAL_API_KEY` and FastAPI verifies `INTERNAL_API_KEY`.
The examples use `gpt-5.6-luna` as the AI model default. Live indexing,
retrieval, and generation can incur embedding or provider usage costs.
Live generation requires a valid OpenAI key. Tests use a fake provider and do
not call OpenAI.

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
- Editing a grounded variation also clears that variation's supporting
  references. Existing saved Generations are reused; choosing knowledge again
  does not regenerate them.
- A supporting reference records provenance for the content used during
  generation, not factual verification. The Draft Studio's **Current source**
  panel fetches the latest source and is not a historical snapshot; it can
  show that the source version has changed.
- Indexing, retrieval, and generation may each incur provider costs. If a
  generation request times out or the outcome is otherwise uncertain, use
  **Check for saved drafts** or open the Drafts library before trying again.
- The Scheduled metric counts approved variations with a planned date,
  including past planned dates, until they are removed.
- Generated claims may be unsupported and must be checked by a human before use.
- The API's in-memory generation guard coordinates one API process only;
  distributed coordination is a future deployment concern.

The implemented Personal RAG workflow is deliberately narrow: text notes,
explicit indexing, owner-scoped retrieval, opt-in context for new
Generations, and supporting-source inspection are available. File uploads,
GitHub ingestion, autonomous agents, automatic publishing, and publishing
automation are future work, not part of this demo.

See [services/api/README.md](services/api/README.md) and
[services/ai/README.md](services/ai/README.md) for service-specific details,
follow the [MVP demo guide](docs/demo-guide.md) for a short end-to-end
walkthrough, and consult the [Personal RAG plan](docs/personal-rag-plan.md)
for upcoming knowledge-grounded generation architecture.
