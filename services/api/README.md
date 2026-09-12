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
