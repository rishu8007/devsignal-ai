# DevSignal API

The Express API owns authentication, Signal ownership, MongoDB persistence,
draft generation, editing, approval, the draft library, and manual calendar
scheduling. It listens on port `4000` by default.

For fresh-clone setup, environment variables, Docker Compose, service URLs,
and the complete verification checklist, see the
[root README](../../README.md).

## Useful commands

Run from the repository root:

```powershell
npm run dev:api
npm run typecheck --workspace=services/api
npm run build --workspace=services/api
npm test --workspace=services/api
```

The API requires `services/api/.env` with a MongoDB URI, JWT settings, web
origin, and an AI-service URL. If AI generation is enabled, its
`AI_INTERNAL_API_KEY` must match the FastAPI service's `INTERNAL_API_KEY`.
Use placeholders from [`.env.example`](.env.example); do not commit secrets.

Generation and scheduling are authenticated and owner-scoped. Editing an
approved variation resets it to `draft` and clears its planned date.
Scheduling is only a manual plan: the API does not publish or run background
jobs. The Scheduled summary includes past planned dates until removed.

Knowledge-source indexing is explicit: `POST /api/v1/sources/:sourceId/index`
requires cookie authentication and an empty request body. The API reads the
owner and source content from MongoDB, claims a bounded indexing lease, and
calls the internal FastAPI endpoint without application retries. Active leases
return `SOURCE_INDEXING_IN_PROGRESS`; expired leases can be retried explicitly.
The lease does not fence an already-running provider or Qdrant operation, so
it is not an exactly-once guarantee. Private attempt, lease, and provider
metadata are never included in public source DTOs.

Deletion is rejected while an active indexing lease exists. Retrieval and
vector cleanup are intentionally deferred: callers must revalidate MongoDB
source ownership and content version before using indexed chunks.

`POST /api/v1/sources/search` performs owner-scoped retrieval through the
internal AI service and validates each candidate against MongoDB before
returning it. The returned score is a similarity score, not factual
confidence. MongoDB validation is a point-in-time check; a source can change
immediately after validation.

### Signal editing and Generation persistence

Signals can be edited before a Generation exists. Updates include the
expected Signal revision and are rejected on an owner, revision, Generation,
or active-reservation conflict.

Generation claims create an expiring `generating` reservation. After provider
output is validated, the API atomically changes the matching Signal revision
and reservation token to non-expiring `persisting` state. That transition
requires the lease to remain unexpired. A Generation is inserted only after
the transition succeeds. Persisting reservations block Signal edits and new
claims regardless of elapsed time; successful persistence conditionally stores
the Generation ID and clears the reservation.

Existing Generations are reused without invoking generation. The saved-draft
lookup is also the reconciliation entry point: when it finds a Generation, the
API conditionally repairs matching persisting protection before returning the
saved result. An empty lookup does not prove that an outstanding write cannot
complete.

`GENERATION_PERSISTENCE_UNCERTAIN` means the Generation save outcome is
unresolved, not that generation is definitely still running. The API retains
persisting protection and does not automatically unlock it based on elapsed
time or an empty lookup. A crash before insertion may therefore require
operational investigation and reconciliation; routine manual clearing is not
safe. The lifecycle tests use injected repositories and clocks, so they do not
prove live distributed race behavior.
