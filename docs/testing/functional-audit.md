# DevSignal AI Functional Audit

Audit started: 2026-10-02
Repository: `D:\devsignal-ai`
Commit under test: `23a415ed45a8d5a75ed7070124e860a4017df645`
Working tree: dirty before audit (`79` status entries, including staged, unstaged, and untracked changes). Existing changes are preserved and not attributed to this audit unless explicitly listed below.

## Scope and safety

- Existing authenticated browser session is used where available.
- No credentials, cookies, tokens, OAuth codes, secret files, prompts, or provider response bodies are recorded.
- Existing user data, reservations, accounts, repositories, keys, and volumes are not deleted, reset, rotated, or disconnected.
- Audit fixtures will use clearly labelled data and will be deleted only if this audit creates them.
- No LinkedIn posts, messages, or GitHub repository writes are permitted.
- Live AI budget: maximum six operations across indexing, retrieval, generation, and workflows. SDK retries and multi-call workflows count toward the budget.
- Live AI operations used: `0` at audit start.

## Baseline inventory

Implemented areas found in the repository:

- Next.js web dashboard, Draft Studio, signals, knowledge UI, research/workflow UI, calendar, analytics, GitHub and LinkedIn connection UI.
- Express API authentication, signals, generations, draft editing/approval, calendar scheduling, knowledge sources/indexing, retrieval, usage accounting, GitHub and LinkedIn integrations, research briefs, workflows, analytics, and reconciliation.
- FastAPI AI service with Gemini text generation, Gemini embeddings (`gemini-embedding-2`, 1536 dimensions), Qdrant retrieval/indexing, structured validation, and provider error mapping.
- MongoDB persistence and Qdrant vector storage.
- Background GitHub sync and LinkedIn scheduler workers.

Relevant commands:

```text
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.app.yml --profile app config --quiet
npm run build
npm run lint
npm run test
npm run typecheck --workspace=services/api
npm run build --workspace=services/api
npm run build --workspace=apps/web
npm run test:browser --workspace=apps/web
services/ai/.venv: ruff check, ruff format --check, mypy --strict, pytest
```

Running local services at audit start:

| Service | Container state | Local endpoint/configuration |
|---|---|---|
| Web | healthy | `http://localhost:3000` |
| API | healthy | `http://localhost:4000` |
| AI | healthy | `http://localhost:8000`, Gemini text model `gemini-3.5-flash-lite` |
| MongoDB | healthy | local port `27017` |
| Qdrant | running | local port `6333` |
| GitHub sync worker | restarting | profile/container requires separate diagnosis |

## Functional checklist

| Area | Status | Notes |
|---|---|---|
| Inventory and baseline | PASS | Baseline captured; service checks and repository test suites are in progress |
| Startup and navigation | PASS with minor finding | Landing, direct dashboard redirect, authenticated dashboard reload, API/AI/Web health, and Qdrant health verified. A browser reload completed with no failed responses. The optional GitHub sync container is configured to restart after its intentional disabled exit; see defects. |
| Authentication | PASS (smoke) | Unauthenticated protected API requests returned `401 AUTHENTICATION_REQUIRED`; the existing authenticated session returned `200` from `/auth/me` for owner `6abe40543a6650cc5d6d198b`. Full account lifecycle remains covered by mocked/integration tests. |
| Signals and learning notes | PASS (smoke/tests pending) | Authenticated signal list returned five existing Signals; direct generation lookup distinguished saved and absent generations. Destructive fixture coverage was not run because no Signal delete route was identified. |
| Draft generation | PASS for exact blocked Signal after fix | Signal `6abf3d3fb7fcfc56ccea2926` (“Work with AI Content Generation”), owner `6abe40543a6650cc5d6d198b`, completed one controlled retry: POST `201`, GET `200`, three required angles, and browser refresh displayed all three drafts. |
| Draft editing and approval | PASS API/mocked browser; BLOCKED deployed UI | Real API fixture checks and mocked editor regressions pass; deployed normal-click verification could not begin because the authenticated dashboard's fixture cards remained unstable during repeated live 409 responses. |
| Content calendar | PASS API; BLOCKED deployed UI | Add/move/remove and Asia/Calcutta behavior passed through the real API and earlier browser fixture checks; the required latest normal-click deployed verification is blocked by the same unstable authenticated dashboard state. |
| Knowledge ingestion and RAG | PASS (service smoke/tests pending) | Qdrant health and both existing collections were readable; no live indexing/retrieval operation was started. |
| GitHub integration | BLOCKED for provider callback | Status is reachable, but provider installation/consent has not completed; no callback or connection record exists for the current owner. |
| Research and agent workflows | PASS (mocked service coverage) | Workflow admission, required persistence fields, citation mapping, and uncertain-work replay protection are covered; browser progress/recovery remains unverified. |
| LinkedIn integration | PASS for status/history scope; callback BLOCKED | Status and read-only publication history returned `200` after the limiter-scope fix; provider consent/callback remains unverified. |
| Usage and analytics | PASS (mocked service coverage) | Analytics boundaries, owner scoping, engagement coverage, and usage transitions are covered; browser analytics display remains unverified. |
| API reliability and security | PASS (smoke) | Protected routes reject omitted cookies; health endpoints respond; no secret-bearing response was recorded. Full suite pending. |

## Test matrix

Results will distinguish mocked/unit, integration, and live browser/provider verification. Each row will include exact commands or reproduction steps, sanitized evidence, and remaining actions.

| Feature | Test | Method | Result | Evidence | Remaining action |
|---|---|---|---|---|---|
| API | `npm run typecheck --workspace=services/api` | Build/typecheck | PASS | TypeScript completed with exit code 0 | None |
| API | `npm run build --workspace=services/api` | Build | PASS | API build completed with exit code 0 | None |
| API | `npm run test --workspace=services/api` | Mocked/unit | PASS | 219/219 tests passed | None for current suite |
| AI | `services/ai/.venv/Scripts/python.exe -m ruff check .` | Static check | PASS | Ruff reported no violations | None |
| AI | `services/ai/.venv/Scripts/python.exe -m ruff format --check .` | Format check | PASS | 74 files already formatted | None |
| AI | `services/ai/.venv/Scripts/python.exe -m mypy --strict app` | Strict typecheck | PASS | No issues in 52 source files | None |
| AI | `services/ai/.venv/Scripts/python.exe -m pytest -q` | Mocked/unit | PASS | Full suite passed; only dependency deprecation warnings | None |
| Web | `npm run lint --workspace=apps/web` | Static check | PASS | No lint errors or warnings | None |
| Web | `npm run test:imports --workspace=apps/web` | Unit | PASS | 13/13 tests passed | None |
| Web | `npm run build --workspace=apps/web` | Build | PASS | Next.js build and TypeScript compilation completed | None |
| Compose | `docker compose ... config --quiet` | Configuration | PASS | Compose accepted the app configuration | None |
| Services | API/AI health endpoints and authenticated dashboard reload | Live local integration | PASS | API, AI, MongoDB, Qdrant, web, and authenticated reload responded successfully | Continue deeper browser coverage |
| GitHub sync | Disabled worker with `--profile github-sync` | Live local integration | PASS after fix | Worker exits `0` and remains `Exited (0)`; no restart loop or host-port conflict | None |
| Exact generation failure | `pytest -q tests/test_generations.py tests/test_gemini_provider.py` | Focused AI regression | PASS | Focused suite passed; safe normalization/citation/Pydantic diagnostics covered | None |
| Exact generation finalization | `npm run test --workspace=services/api` | API regression | PASS | Full API runner exited `0`; all executed files passed after the finalization fix | None |
| Exact Signal generation | Authenticated POST → GET → browser refresh | Live local integration/provider | PASS | Signal `6abf3d3fb7fcfc56ccea2926`: POST `201`, GET `200`, three drafts displayed; completed reservation recorded | Continue remaining audit areas |
| Invalid-response finalization | `node --import tsx --test --test-concurrency=1 test/usage.repository.recovery.test.ts test/usage.service.test.ts` | Mocked service/repository regression | PASS | 22/22 tests passed: dispatched release increments consumed quota and remains counted; never-dispatched release refunds; timeout/uncertain work remains duplicate-blocking; invalid generation persistence is covered by generation tests | None for the transition defect |
| Draft editing and cancel | Select isolated fixture in Draft Studio; edit Technical depth; enter cancel sentinel; cancel | Authenticated browser | PASS | Unsaved `AUDIT CANCEL SENTINEL` never replaced the saved draft content | None |
| Draft edit persistence | Edit isolated fixture Technical depth; save `AUDIT SAVED SENTINEL`; reload; reopen Draft Studio | Authenticated browser → real API/MongoDB | PASS | Save returned the updated draft; after reload the sentinel remained visible in the fixture | Fixture retained |
| Approval and refresh | Approve isolated fixture Technical depth; reload; reopen Draft Studio | Authenticated browser → real API/MongoDB | PASS | Variation showed `Approved` before and after reload; no publishing action was invoked | None |
| Approval invalidation | Edit the approved fixture variation through Draft Studio and save | Authenticated browser → real API/MongoDB | PASS | Status changed to `Draft`, planned date disappeared, and the edited content remained after refresh; no publish call occurred | None |
| Manual calendar add/move/remove | Add `2026-10-05T10:30` Asia/Calcutta; move to `2026-10-06T10:30`; remove; add final verification date | Authenticated browser/API → real API/MongoDB | PASS | API responses were `200`; calendar displayed the fixture on Oct 5 at 10:30 AM with `Asia/Calcutta`; remove cleared the date; final fixture date was cleared by approval-invalidation verification | Fixture retained |
| Draft validation preservation | Edit fixture; enter `too short` | Authenticated browser | PASS | Save remained disabled, the `100–3000` validation message appeared, and the invalid text remained in the editor without a request | None |
| Failed draft save preservation (HTTP) | Mock received `PATCH` 503 after editing Technical depth | Mocked browser regression | PASS | Complete `draft-generation-retry.spec.ts` passed 7/7; one PATCH, safe error, editor visibility, and unchanged textarea were verified | Deployed UI check blocked |
| Failed draft save preservation (network) | Abort `PATCH` to simulate an uncertain transport outcome | Mocked browser regression | PASS | Complete spec passed 7/7; one PATCH, unchanged textarea, in-editor `Check for saved drafts`, and GET recovery were verified | Deployed UI check blocked |
| Draft editing/approval/calendar controls after web deploy | Normal clicks on retained fixture `6abf59b2d71b45a2e82fde1a` | Deployed authenticated browser | BLOCKED | `View drafts` remained visible/enabled but Playwright could not complete a normal click or scroll because the element never became stable; the page logged repeated live 409 responses. No force/native click was used. | Re-run with stable authenticated session and correlate the 409 endpoint |

## Defects

### GitHub sync worker restart loop (minor, fixed)

- Reproduction: with the optional `github-sync` profile enabled but GitHub sync disabled, the worker logs `disabled or GitHub is not configured.` and exits with status `0`; Compose used `restart: unless-stopped`, so the container repeatedly restarted.
- Expected: an intentionally disabled optional worker should remain stopped while still restarting on an unexpected non-zero failure.
- Fix: changed only `github-sync` in `docker-compose.app.yml` to `restart: on-failure` and reset inherited API port publishing with `ports: !reset []`.
- Validation: Compose accepted the configuration; the recreated disabled worker exited once with status `0` and remained stopped.

### Exact Signal generation failure and stale admission blocker (fixed)

- Signal: `6abf3d3fb7fcfc56ccea2926`, owner `6abe40543a6650cc5d6d198b`.
- Original operation: reservation `6abf3d47b7fcfc56ccea2928`, operation key ending `efb9beda-058f-4bc7-8726-63f634676dfe`, dispatched at `2026-10-02T05:12:39.400Z`, then `uncertain`.
- AI evidence: correlation ID `0eedc66c-20dd-4c3c-8221-531acd476a5b`, HTTP `502`, `AI_INVALID_RESPONSE`, `ValueError`, and the old diagnostic reported `stage=unknown`, `upstream_status=none`, `reason=unknown`. This proves the failure occurred after the provider call in application validation, rather than a transport timeout or Gemini API error. The historical log did not retain the specific variation/citation constraint, so that field cannot be recovered retrospectively without inventing evidence.
- The later `AI_OPERATION_IN_PROGRESS` response was the admission guard rejecting a retry while the prior reservation was still `uncertain`; it was not a second provider failure. The exact operation was eligible for the audited reconciliation route because it was expired, uncertain, and had no active Signal lease.
- Fix: invalid received responses now produce safe AI diagnostics identifying `variation_normalization`, `citation_validation`, or provider `response_validation`, including only allowlisted reasons or Pydantic error type/path. Express/API validation remains strict.
- Fix: `AI_INVALID_RESPONSE` now releases the dispatched usage reservation instead of marking it uncertain. Transport timeouts and provider 5xx failures remain uncertain because their outcome is unknown.
- Accounting regression: a dispatched release decrements `reserved` and increments `completed`, so the invalid response remains consumed and cannot reclaim quota. A pre-dispatch release still refunds the reservation. Usage summaries count dispatched releases as used, while retries remain blocked for uncertain timeouts.
- Focused verification: the repository/service regression command above exited `0` with `22/22` tests passing. No live provider call or existing user record was used. Invalid generation persistence remains guarded by the generation-service tests, and no generation is saved before successful validation.

### Draft failed-save editor visibility (fixed)

- Reproduction: on the retained audit fixture, edit a draft, disable browser connectivity, and submit the valid edit. The API request failed with `net::ERR_INTERNET_DISCONNECTED`; the UI showed the safe uncertain-save message but hid the editor, so the in-progress text was no longer visible.
- Root cause: `dashboard-workspace.tsx` passed `mutationUncertain` through the Draft Studio's top-level `error` prop. Draft Studio hides its generation cards whenever that prop is set, even though the edit state and content remained in React state.
- Fix: only generation-load errors now use the top-level Draft Studio error prop. Mutation errors remain attached to the active variation editor, preserving the user's text while still showing the safe failure message and avoiding an automatic retry.
- Regression: the rebuilt web app's complete `draft-generation-retry.spec.ts` passed (`7/7`, exit code `0`). It covers received HTTP failure and aborted network failure, asserts one PATCH with no automatic duplicate, preserves the textarea, and exercises saved-draft recovery. No Gemini call or real mutation was used by the regression.
- The latest deployed verification was blocked before dispatching a save: ordinary `View drafts` interaction could not complete because the live page was continuously unstable while logging repeated `409 Conflict` responses. Therefore no deployed lost-response save outcome was claimed, and the retained fixture was not modified by this attempt.
- Recovery: the exact old operation was reconciled at `2026-10-02T06:22:00.650Z` with consumed usage preserved.
- Controlled verification: the authenticated POST for this exact Signal returned `201`; GET returned `200` with model `gemini-3.5-flash-lite` and three variations; after refresh, Draft Studio displayed Technical depth, Learning story, and Professional impact.

### Startup/navigation evidence

- `GET http://localhost:3000/` returned `200` and rendered the landing page.
- Unauthenticated direct navigation to `/dashboard` redirected to `/login`.
- The existing authenticated dashboard session rendered `/dashboard` and survived reload.
- `GET http://localhost:4000/api/v1/health` returned `200`.
- `GET http://localhost:8000/api/v1/health` returned `200`.
- `GET http://localhost:6333/healthz` returned `200`.
- The authenticated dashboard reload had no failed HTTP responses. Earlier session history contained transient `404`, `409`, and `502` responses from prior interactions; those were not reproduced by reload and are recorded only as historical browser evidence pending endpoint-level correlation.
- `github-sync` logs report `disabled or GitHub is not configured.` and the container exits cleanly once. This is expected when the optional worker is disabled; the restart-policy fix is recorded above.

## Audit fixtures

Audit fixtures retained because no supported Signal/generation delete operation was identified:

- Signal `6abf59b2d71b45a2e82fde1a`: `AUDIT FIXTURE - Draft and Calendar Verification`.
- Generation `6abf5ba5be92935b95a9d4fb`.
- Technical-depth variation `6abf5ba5be92935b95a9d4fc`.
- Learning-story variation `6abf5ba5be92935b95a9d4fd`.
- Professional-impact variation `6abf5ba5be92935b95a9d4fe`.
- The fixture was created without a Gemini call by cloning an existing generation structure, resetting statuses to `draft`, clearing citations and schedules, and changing the stored source topic to the fixture title. Only this labelled fixture was modified.

Live AI operations used during this audit: `1/6`. One controlled generation was completed for the exact Signal above. The new regression is fully mocked; no additional live AI operation was used.

The baseline checks passed, but the full functional audit remains incomplete. Remaining feature-area checks are not represented as complete merely because the service suites pass.

## Highest-priority next actions

1. Complete authenticated browser coverage for knowledge-source lifecycle, workflows, and analytics using isolated fixtures; add a Signal deletion path or an approved cleanup procedure before creating additional persistent fixtures.
2. Have the user complete GitHub installation/OAuth consent, then verify callback, owner-scoped persistence, and refresh behavior; repeat LinkedIn consent verification without publishing.
3. Capture a request and correlation ID if Draft Studio again shows an invalid-provider-response message; the current saved-generation read does not establish a live defect.

## Fixes made during audit

- `docker-compose.app.yml`: prevent the disabled optional GitHub sync worker from restarting after a clean exit.
- `services/ai/app/services/generation_service.py`: add safe stage/reason diagnostics for variation normalization and citation validation.
- `services/ai/app/providers/gemini_provider.py`: add safe provider response-shape and Pydantic validation diagnostics.
- `services/api/src/services/generation.service.ts`: release received invalid responses while retaining uncertain handling for unknown transport/provider outcomes.
- `services/api/src/repositories/usage.repository.ts` and `services/api/src/services/usage.service.ts`: preserve consumed quota/accounting when a dispatched operation is released after a definitive invalid response.
- `apps/web/src/components/dashboard/dashboard-workspace.tsx`: keep the active draft editor visible when an edit save has an uncertain/network failure.
- `apps/web/src/components/dashboard/draft-studio.tsx`: keep the saved-draft recovery control inside the active editor for uncertain edit outcomes.
- Focused regression tests cover safe diagnostics, invalid-response finalization, stateful quota transitions, retry admission, and uncertain timeout blocking.
- `apps/web/test/browser/draft-generation-retry.spec.ts`: verify HTTP and network-failed draft saves preserve the in-progress editor content, avoid duplicate PATCH calls, and support recovery.

## Checkpoint handoff (2026-10-05)

Development is paused after the current implementation checkpoint.

- AI generation is working and was confirmed by the user. Mocked AI/provider,
  API, repository, and browser regression checks remain distinct from live
  generation verification.
- LinkedIn connection and posting permission are working. The user completed
  OAuth, confirmed the dashboard status as Connected after refresh, and
  confirmed a real LinkedIn post was published and visible on LinkedIn.
- GitHub connection remains unresolved; provider installation/callback
  verification is still blocked.
- The full functional audit remains incomplete. Areas marked BLOCKED,
  incomplete, or pending above are not promoted to PASS by this checkpoint.
- Local Compose uses HTTP origins with production-mode containers. The auth
  cookie implementation derives `Secure` from the configured HTTPS origin;
  HTTPS deployments must retain Secure cookies.
- The local LinkedIn identity-conflict recovery was targeted to the
  diagnostic-confirmed connection and preserved publication history. No
  provider secrets or account credentials are recorded here.
