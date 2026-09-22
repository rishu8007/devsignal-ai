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

## LinkedIn connection

LinkedIn connection is optional and disabled unless `LINKEDIN_ENABLED=true`.
When enabled, configure a LinkedIn developer application with the fixed
callback URL in `LINKEDIN_REDIRECT_URI`, client credentials, and a dedicated
base64-encoded 32-byte `LINKEDIN_TOKEN_ENCRYPTION_KEY`. The tracked
`services/api/.env.example` contains placeholders; never put real credentials
in source control. The Compose app forwards these settings without requiring
them when the integration is disabled.

The connection flow is server-owned authorization-code OAuth with persisted,
single-use state bound to the DevSignal session and S256 PKCE. It stores only
encrypted access/refresh credentials and safe identity metadata. Disconnect
removes locally usable credentials; LinkedIn remote revocation is not called by
this connection-only milestone. Expired connections require reconnecting.
Identity scopes (`openid profile email`) are distinct from posting capability;
posting is shown as unavailable unless a future, separately approved product
scope is granted. No LinkedIn publishing, scheduling, analytics, scraping, or
browser automation is implemented.

Official documentation consulted:

- [LinkedIn OAuth overview](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication)
- [Authorization-code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [Programmatic refresh tokens](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)
- [Getting API access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
- [Sign In with LinkedIn using OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)

LinkedIn access is product/application dependent: posting permission generally
requires `w_member_social`, and refresh tokens are not available to every
application. This milestone does not assume either permission. Mocked provider
tests cover the local boundary; live LinkedIn consent, product approval,
provider revocation, and browser redirect checks remain deferred.

LinkedIn text publishing is a separate, opt-in capability. Set
`LINKEDIN_PUBLISHING_ENABLED=true` only after the configured application has
the documented member-posting product and request `w_member_social` through
the explicit posting-consent flow. A user can publish only an owned,
currently approved variation. The API creates an expiring server-derived
preview containing the exact text, account, visibility, and content hash;
confirmation revalidates those inputs immediately before an atomic dispatch
claim. Publication records are immutable snapshots with bounded owner-scoped
history. Duplicate previews and confirmations reuse the existing operation,
while timeouts, connection loss, missing identifiers, and persistence
ambiguity become uncertain and never automatically repost.

Publishing uses LinkedIn's documented `POST /rest/posts` member endpoint with
`X-Restli-Protocol-Version: 2.0.0`, a configured `LinkedIn-Version`, the
authenticated member's `urn:li:person:{id}` author, `PUBLIC` visibility, and
text commentary. The documented post identifier is read from `x-restli-id`
(or a validated response identifier). Organization posts, media, scheduling,
analytics, and automatic publishing are not implemented. See the
[Posts API documentation](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2025-10)
and [member authorization documentation](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow).
Live compatibility, product approval, and real-provider behavior remain
deferred; all local tests use mocked provider responses.

Scheduled LinkedIn publishing is separately disabled by default with
`LINKEDIN_SCHEDULER_ENABLED=false`. When enabled, the same immutable
publication snapshot and duplicate operation key are used for scheduling and
Publish now. Scheduling stores the UTC execution instant and the selected
IANA timezone, requires an explicit scheduling confirmation, and validates
nonexistent/repeated daylight-saving times. Repeated local times require an
earlier/later choice. The default horizon is 90 days and the default late
window is 60 minutes; jobs overdue beyond that window become `missed` instead
of publishing an unexpected backlog.

The API process starts a bounded, lease-based due-job worker only when the
scheduler flag is enabled. It has no public port and does not run in local
development unless explicitly configured. Claims are fenced, cancellation and
rescheduling compete atomically, and a job is revalidated immediately before
dispatch. A crash or timeout after dispatch remains uncertain and is never
blindly retried. Ordinary manual Calendar entries remain reminders and never
become automatic jobs. The scheduled worker has mocked-clock tests; live
MongoDB races and browser timezone rehearsals remain deferred.

The worker entry point is `startLinkedInSchedulerWorker` in
`services/api/src/services/linkedin-publication.service.ts`; the normal API
server starts it after indexes are initialized, and it is a no-op while
`LINKEDIN_SCHEDULER_ENABLED=false`. No separate scheduler process or public
worker port is required.

For an isolated worker process, build the API and run
`npm run scheduler --workspace services/api` with
`LINKEDIN_SCHEDULER_ENABLED=true`. Do not enable the scheduler in both the API
and isolated worker processes for the same deployment. The worker claims one
job at a time, stops new claims on SIGINT/SIGTERM, and leaves an in-flight
dispatch fenced for recovery rather than replaying it.

## Signal content workflow

The dashboard can start a bounded, persisted workflow from a saved Signal
after the user explicitly selects current indexed Knowledge sources. The
workflow reuses the existing research, generation, and technical-review
services, then pauses at a durable LangGraph human-approval interrupt. The
Express `ContentWorkflow` record is authoritative for user-visible status and
links to the saved research brief, generation, and review; the LangGraph
checkpoint stores execution and resume position using the persisted thread ID.
Approval is explicit for one exact draft revision and completion does not
publish or schedule anything.

Workflow-generated drafts retain the same server-owned citation mapping as
manual Knowledge-grounded generation. Model-returned evidence IDs are checked
against the exact supplied evidence, then mapped to the current source title,
content version, chunk identity, and offsets before persistence; fabricated
references fail the workflow. The technical-depth review is reused when it is
current; learning-story and professional-impact variations expose an explicit
Review this variation action. Each review is bound to its own generation,
variation, content hash, Signal, and research evidence before approval is
enabled.

For local workflow execution, configure the AI service with a dedicated
checkpoint MongoDB URI and database (`WORKFLOW_CHECKPOINT_URI` and
`WORKFLOW_CHECKPOINT_DATABASE`). The API initializes workflow uniqueness
indexes before listening and the AI service constructs the MongoDB checkpointer
before serving workflow requests. Without checkpoint configuration, workflow
requests are rejected rather than using non-durable in-memory state.

The API worker claims queued runs with a lease and persists each step. Reloads
and restarts reuse completed persisted outputs; an expired lease or uncertain
provider outcome is surfaced as uncertain and is not automatically replayed.
Cancellation prevents later steps, although an already-dispatched provider
request may still finish and incur usage. This does not provide exactly-once
provider execution: a crash between provider completion and persistence can
remain uncertain. Live MongoDB concurrency rehearsals and browser regression
checks remain deferred.

The automated workflow tests use mocked providers and an in-memory LangGraph
checkpointer, including rebuilding the graph executor before resume. They do
not prove MongoDB checkpoint recovery or multi-worker races. Live approval
competition, cancellation races, and browser reload/review-selection checks
remain on the deferred testing checklist. The checkpoint database is separate
from the application database when configured; backup coverage for that
database must be extended before production rollout.

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

## Knowledge-grounded topic planning

The **Topics** workspace lets an authenticated user select one to five
currently indexed Knowledge sources, optionally provide an audience and goal,
and explicitly generate three to five structured topic ideas. Only the
selected source text is sent to the AI service; profile fields and unrelated
Knowledge are not implicitly included. Each suggestion shows its supporting
source IDs and missing evidence. Editing the Signal topic and learning notes
shows the exact Signal fields that will be saved; edited notes remain separate
from the original AI evidence references. Choosing **Create Signal** creates
only the Signal: it does not generate drafts, approve content, index sources,
or schedule publication.

Plans are owner-scoped, persisted, paginated in Recent plans, and
request-idempotent. Source ownership, indexed status, and content versions
are checked before planning and again before conversion; changed evidence
requires a fresh plan. AI source references are validated against the
selected evidence. The planner uses bounded inputs and does not perform
external research. Database-enforced unique planning provenance prevents
duplicate conversions; live MongoDB concurrency checks remain deferred and
standalone MongoDB does not provide replica-set transactions. Running plans
that become older than ten minutes are shown as uncertain and are never
automatically retried.

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

## Prepared single-server HTTPS deployment

The reviewable hosted deployment is a separate
[docker-compose.deploy.yml](D:/devsignal-ai/docker-compose.deploy.yml). It
uses Caddy as the only published service (`80` and `443`), routes
`/api/v1` and `/api/v1/*` to the API without rewriting the prefix, and routes
all other paths to Next.js. Web, API, AI, MongoDB, and Qdrant have no
published host ports. Caddy certificate state and all application data use
deployment-specific named volumes; this does not reuse or migrate the local
Compose volumes.

Before a future deployment, provide DNS for the chosen domain to the server
and allow inbound TCP `80` and `443`. Copy the placeholder file and replace
all values:

```powershell
Copy-Item .env.deploy.example .env.deploy
# Edit .env.deploy privately; do not print or commit it.
docker compose -p devsignal-https -f docker-compose.deploy.yml --env-file .env.deploy config --quiet
docker compose -p devsignal-https -f docker-compose.deploy.yml --env-file .env.deploy build
docker compose -p devsignal-https -f docker-compose.deploy.yml --env-file .env.deploy up -d
docker compose -p devsignal-https -f docker-compose.deploy.yml --env-file .env.deploy ps
```

The public origin and `PUBLIC_DOMAIN` must match. The browser API base is
`/api/v1`, so it is same-origin and is embedded in the web image at build
time. Changing it or other `NEXT_PUBLIC_*` values requires rebuilding the web
image. Server-only values require recreating the affected service. Production
cookies are HttpOnly, Secure, and SameSite=Lax; the local HTTP Compose
workflow remains separate and uses its existing non-production settings.

`TRUST_PROXY_HOPS=1` is deployment-only: Express trusts exactly one network
hop, the Caddy container, because the API has no published host port and the
Compose file exposes no shorter public API path. Direct development defaults
to `0`, so forwarded headers are not trusted. Caddy's default reverse-proxy
behavior ignores untrusted incoming `X-Forwarded-*` values and constructs
those headers from the connected client; do not add another ingress or enable
additional Caddy trusted-proxy ranges without revisiting this assumption.
Login and registration rate limits use the resolved client IP; generation
limiting remains per authenticated user.

Cookie-authenticated state-changing requests also require an `Origin` matching
`PUBLIC_ORIGIN`. CORS controls browser response access but does not stop a
cross-origin state-changing request, so this explicit origin check is the
deployment's CSRF defense. Requests without the authentication cookie (such
as login) are not subject to this cookie-write check.

Validate Caddy configuration in an isolated container before deployment; this
does not bind ports or request certificates:

```powershell
docker run --rm -e PUBLIC_DOMAIN=example.test `
  -v "${PWD}\deploy\Caddyfile:/etc/caddy/Caddyfile:ro" `
  caddy:2.10.2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Check the public site at `https://your-domain.example` and complete a normal
login. Health endpoints are internal deployment checks; a healthy HTTP
process does not prove provider credentials, indexing, retrieval, or
generation. Saving/indexing/searching and generation may incur provider cost;
opening the site and logging in do not.

Use bounded operational output:

```powershell
docker compose -p devsignal-https -f docker-compose.deploy.yml --env-file .env.deploy ps
docker compose -p devsignal-https -f docker-compose.deploy.yml --env-file .env.deploy logs --tail 100 caddy web api ai
```

For backup operations, use `mongodump`/`mongorestore` against MongoDB through
an isolated administrative connection, and use the Qdrant snapshot API for
the configured collection. Copy resulting artifacts to protected storage and
restore both into a separate test project before relying on a backup. An
image rollback is not a data rollback: MongoDB and Qdrant data formats and
application schema compatibility must be checked separately.

Application updates should be built and started under the same explicit
Compose project after reviewing the image changes. To roll back, use the
previous application source/image versions and recreate only the affected
application services after confirming database compatibility. To stop without
deleting data:

```powershell
docker compose -p devsignal-https -f docker-compose.deploy.yml --env-file .env.deploy stop
```

Do not use `down -v` or volume-prune commands as routine recovery. This
configuration is prepared only; no hosted deployment, DNS change, certificate
request, or data migration has been performed. Local data is not copied to
this deployment automatically.

### Backup and isolated restore rehearsal

Backups are separate MongoDB and Qdrant operations, not an atomic
cross-store snapshot. Before backing up, schedule maintenance and stop
application writes manually. For the deployment project:

```powershell
docker compose -p devsignal-https -f docker-compose.deploy.yml --env-file .env.deploy stop web api ai
```

The backup tooling requires an explicit acknowledgment that writes are
paused. It does not stop services automatically, publish database ports, or
export container environments:

```powershell
node scripts/backup.mjs `
  --project devsignal-https `
  --compose-file docker-compose.deploy.yml `
  --env-path .env.deploy `
  --output backups\2026-09-17T1530Z `
  --collection devsignal_knowledge_chunks `
  --dry-run

node scripts/backup.mjs `
  --project devsignal-https `
  --compose-file docker-compose.deploy.yml `
  --env-path .env.deploy `
  --output backups\2026-09-17T1530Z `
  --collection devsignal_knowledge_chunks `
  --writes-paused
```

The output directory must not already exist. A successful backup contains
`mongodb.archive`, `qdrant-collection.snapshot`, and
`backup-manifest.json`. The manifest records format version, UTC time, commit
when available, database/collection names, pinned service images, artifact
sizes, SHA-256 checksums, and complete status. If either operation fails,
`backup-manifest.incomplete.json` is preserved and no success manifest is
written. Backup artifacts contain private user data; protect them with
restricted filesystem permissions and encrypted off-machine storage. Never
put credentials, connection strings, note text, or environment dumps in the
manifest.

Before restore, validate the manifest and checksums without invoking any
database or snapshot operation:

```powershell
node scripts/restore.mjs `
  --project restore-test-20260917 `
  --compose-file docker-compose.restore.yml `
  --manifest backups\2026-09-17T1530Z\backup-manifest.json
```

Restore requires the `restore-test-` project prefix, a complete manifest, safe
artifact paths, matching sizes/checksums, and a target with no existing
containers or volumes. It never defaults to the local or deployment project.
Execute only after reviewing the dry-run plan:

```powershell
node scripts/restore.mjs `
  --project restore-test-20260917 `
  --compose-file docker-compose.restore.yml `
  --manifest backups\2026-09-17T1530Z\backup-manifest.json `
  --execute
```

The isolated restore Compose file has fresh private MongoDB and Qdrant
volumes and no published database ports. The script creates a protected
temporary restore credential file, removes it in a `finally` path, and leaves
the restore environment running for inspection; it never deletes containers
or volumes automatically. Verify read-only state with commands such as:

```powershell
docker compose -p restore-test-20260917 -f docker-compose.restore.yml ps
docker compose -p restore-test-20260917 -f docker-compose.restore.yml exec mongo sh -c 'mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "db.getSiblingDB(\"devsignal\").getCollectionNames()"'
```

Use the pinned Qdrant version's read-only collection information and snapshot
API through a temporary network client; do not expose Qdrant publicly. Keep
application services stopped until both stores have completed backup, because
simultaneous indexing or editing can make the two stores inconsistent. Resume
the application services manually only after verification:

```powershell
docker compose -p devsignal-https -f docker-compose.deploy.yml --env-file .env.deploy start api web ai
```

A backup is not proven recoverable until an isolated restore rehearsal
succeeds. Image rollback and data restoration are different operations, and
an image rollback does not roll back database or vector-store data. Store an
off-machine copy and rehearse restoration into a separate project. No
destructive cleanup command belongs in the normal workflow; in particular,
do not use `down -v` or volume pruning for backup recovery.

#### Completed local rehearsal record

On 2026-09-17, application commit metadata was recorded in the generated
manifest when available. With the local `devsignal-ai` web/API/AI containers
stopped and MongoDB/Qdrant left running, the following secret-free operation
was completed:

```powershell
node scripts/backup.mjs --project devsignal-ai --compose-file docker-compose.yml --env-path .env --output backups\20260917T1648Z --collection devsignal_knowledge_chunks --writes-paused
node scripts/restore.mjs --project restore-test-20260917-1648 --compose-file docker-compose.restore.yml --manifest backups\20260917T1648Z\backup-manifest.json
node scripts/restore.mjs --project restore-test-20260917-1655 --compose-file docker-compose.restore.yml --manifest backups\20260917T1648Z\backup-manifest.json --execute
docker compose -p restore-test-20260917-1655 -f docker-compose.restore.yml stop
```

The backup manifest and both artifact checksums validated. The isolated
restore completed into fresh volumes with no published database ports.
Read-only verification matched the paused baseline: MongoDB collections
`users=7`, `signals=7`, `generations=4`, and `knowledgeSources=7`; Qdrant
`points_count=7`, vector size `1536`, and distance `Cosine`. Counts and
collection configuration were checked, but this does not prove every
application query or future restore is correct. The original web/API/AI
containers were restarted and healthy afterward. Restore projects
`restore-test-20260917-1638`, `restore-test-20260917-1645`, and
`restore-test-20260917-1648` remain stopped with their separate volumes for
diagnosis; the successful `restore-test-20260917-1655` volumes are also
retained. The earlier `backups\20260917T1638Z-2` backup remains retained but
must not be used because it was created before the binary archive fix and is
corrupt. No live restore was performed against a hosted deployment.

## GitHub documentation imports

Knowledge supports importing one reviewed Markdown or text file from a public
`https://github.com/owner/repository` repository. The optional branch defaults
to the repository's default branch. The API resolves that branch to a commit,
lists the repository tree through GitHub's REST API, excludes hidden,
dependency/build, symlink, submodule, and unsupported files, and pins the
preview and file read to that commit. Repository listings marked truncated,
invalid UTF-8, empty files, and files over the 20,000-character source limit
are rejected or shown as skipped; content is never silently truncated.

The browser requires the user to preview and read a selected file before
saving it as a note. Saving does not index the note. Imported sources retain
their repository URL, branch, file path, commit SHA, blob SHA, and content
hash. The source detail view can check for upstream changes and shows current
and incoming content before an explicit refresh. Local edits require a
separate acknowledgment, stale content versions and active indexing leases
are rejected, and a disappeared upstream file leaves the local note intact.
Preview tokens expire after ten minutes and GitHub requests use fixed
`api.github.com` endpoints, bounded responses, no redirects, timeouts, and
authenticated rate limiting. Private repositories and OAuth credentials are
not supported.

Manual check: sign in, open **Knowledge → Import from GitHub**, enter a public
repository URL, preview the files, select a Markdown/text file, review it,
and save it. Confirm the new note is pending, use **Check for upstream
changes** from its provenance panel, and use the existing **Index source**
action only when you explicitly want to incur embedding-provider usage.

## Professional profile

The authenticated **Profile** workspace stores a user-owned professional
headline, summary, skills, target roles, audience, resume text, and up to 20
project entries. Profile saves use an expected revision and reject stale
updates; the first save is an atomic owner-scoped upsert. Empty optional
fields are valid. Profile persistence never calls AI or indexes content.

Users can preview the exact title and content for a profile summary, resume,
or individual project and explicitly save that selection as a Knowledge note.
The export stores profile identity, section, profile revision, and a content
hash as provenance. Repeated unchanged exports are idempotent. Later profile
changes require a new preview and explicit note update; local note edits
require acknowledgment, and changed notes become pending for explicit
reindexing. Saving a profile or knowledge note is separate from **Index
source**.

TXT/Markdown files and selectable-text PDFs can be reviewed before replacing
resume text. Unsupported files, invalid UTF-8, blank extraction, oversized
content, encrypted/scanned PDFs, and OCR cases are rejected; file selection
never saves automatically. Canceling an import leaves the current profile
input unchanged.

### Development checklist

The following GitHub-import cases remain unverified and are intentionally not
expanded by the profile milestone:

- Concurrent import idempotency.
- Refresh/version conflicts and indexing leases.
- Expired previews.
- Explicit save/cancel UI behavior.

Topic-planning verification in this checkpoint covers mocked ownership,
indexed-version, fabricated-reference, request-key, stale-source,
duplicate-conversion, independent-suggestion, and no-automatic-generation
paths. Live MongoDB concurrency checks and browser-level reopening tests
remain deferred; mocked tests do not prove database race behavior.

## Saved research briefs

From an existing Signal, the **Research** action lets an authenticated user
select one to five indexed Knowledge sources and explicitly build a saved
research brief. The brief contains relevant evidence, proposed talking
points, claim assessments, missing information, questions, limitations, and
expandable excerpts. Evidence is labeled as supported by selected sources;
these assessments are not independently verified facts.

Research uses personal Knowledge only. Retrieval is restricted to the
selected owner-scoped sources, current indexed content versions, and bounded
evidence excerpts. Evidence IDs are validated against the retrieved
candidate set, and displayed quotations are copied from the retrieved text
rather than trusted from model output. No-evidence results are valid and are
shown explicitly. Research never edits a Signal, generates drafts, approves
content, indexes sources, or schedules publication.

Briefs are persisted with the Signal revision, source versions, and an input
fingerprint. Reopening a brief rechecks current Signal/source versions and
marks historical results stale without deleting them. Request claiming uses
database uniqueness; uncertain provider outcomes are persisted and are not
automatically retried. Live MongoDB race rehearsal and browser-level research
flow tests remain deferred, and external web research is not included.

## Technical draft review

From an existing draft, **Review draft** requires a current saved research
brief for the same Signal. The reviewer compares the exact saved draft
snapshot with only that brief's validated evidence and stores bounded,
advisory findings. Findings distinguish evidence concerns from writing advice;
“unsupported” means unsupported by the supplied material, not false.

Users can inspect saved review history, edit an optional proposed revision,
and explicitly apply it. Applying uses an atomic expected-content predicate,
does not call AI again, and resets approval, scheduling, and citations using
the existing draft-edit behavior. Reviews become stale when the draft, Signal,
or selected Knowledge versions change. Review requests use a unique request
key, persist failed/uncertain outcomes, and use the research no-retry provider
path. Reviews never approve, publish, schedule, index, or generate drafts.

Live MongoDB race rehearsal and browser-level review/apply regression tests
remain deferred; mocked service tests do not prove distributed concurrency
safety.

Workflow variation-review checks currently cover server-side binding helpers
and mocked graph execution. Live MongoDB competing approvals, duplicate
variation-review races, cancellation during an explicit review, and browser
reload/selection recovery remain deferred.

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

### Browser regression checks

The web browser suite runs the production Next.js server on port `3100` and
mocks the API at the browser boundary. It does not start API, AI, MongoDB, or
Qdrant, and it makes no provider calls or database writes. Existing Docker
services may remain running.

From `D:\devsignal-ai`, install Chromium once and run:

```powershell
npx playwright install chromium
$env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:3100/api/v1"
npm run build --workspace=apps/web
npm run test:browser --workspace=apps/web
```

The browser command prepares the generated standalone server's local
`public` and `.next/static` assets, then starts and stops that production
server itself. Tests use
synthetic authenticated data and cover frontend session handling, Knowledge
search request behavior, and real packaged PDF/ZIP browser extraction. They
do not test real cookie security, backend authentication, database validation,
indexing, generation, or provider behavior. On failure, inspect
`apps\web\playwright-report` and `apps\web\test-results` for the HTML report,
screenshots, and traces.

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
Generations, supporting-source inspection, public GitHub imports, and
professional profile exports are available. Autonomous agents, automatic
publishing, and publishing automation are future work, not part of this demo.

See [services/api/README.md](services/api/README.md) and
[services/ai/README.md](services/ai/README.md) for service-specific details,
follow the [MVP demo guide](docs/demo-guide.md) for a short end-to-end
walkthrough, and consult the [Personal RAG plan](docs/personal-rag-plan.md)
for upcoming knowledge-grounded generation architecture.
