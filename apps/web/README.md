# DevSignal web app

The Next.js app provides the marketing page and authenticated dashboard for
Signals, draft generation, editing, approval, copying, and the manual content
calendar. It listens on port `3000` by default.

See the [root README](../../README.md) for fresh-clone setup, localhost
cookie-session configuration, service URLs, and the full verification list.

Run from the repository root:

```powershell
npm run dev:web
npm run lint --workspace=apps/web
npm run build --workspace=apps/web
```

The only required browser setting is
`NEXT_PUBLIC_API_BASE_URL`, normally
`http://localhost:4000/api/v1`. Copy it from
[`.env.example`](.env.example) to `apps/web/.env.local` only when that file
does not already exist.
