# DevSignal AI Personal RAG demo

This concise walkthrough demonstrates the implemented human-reviewed
Personal RAG workflow. Use a test account and never paste real credentials or
secrets into the demo.

## Before you start

Open `http://localhost:3000`. If you need an account, choose **Create one**
and register with a test email and password, then sign in. Keep the browser
and API on consistent `localhost` hostnames so the HTTP-only cookie session
works as expected.

Live generation requires a valid OpenAI key and may incur usage costs. To
demonstrate the UI without another provider request, use the existing-draft
route below.

Start one AI service from the repository root:

```powershell
& services\ai\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services\ai --reload
```

Use only one AI service on port 8000. `--reload` watches the current code and
restarts that Uvicorn process after local changes; it is not a reason to
launch a second server. If port 8000 is already in use, reuse the healthy
service or stop that specific process before starting another one.

## End-to-end path

### 1. Save and index a Knowledge note

Open the **Knowledge** tab and enter a short note. For example:

- **Title:** `Request tracing notes`
- **Text notes:** `I added request tracing to our Express API with a
  correlation ID carried through middleware and database calls. The main
  lesson was to make the ID visible in every error response and log context
  without logging request payloads or credentials.`

Choose **Save knowledge source**. In the saved source list, choose **View
details**, inspect its processing status, and choose **Index source** followed
by **Confirm and index**. Wait until the status is **Indexed** before using
the note for grounded generation. Indexing sends note text to the configured
embedding provider and may incur usage costs.

Use the status filter above the saved source library to view **All**,
**Pending**, **Indexing**, **Indexed**, or **Failed** sources. Filtering only
changes the list view; it does not index, search, or modify notes.

### 2. Create a Signal and opt into knowledge

On the **Create** tab, save a Signal with a topic and learning notes. Select
the Signal, then select **Use my knowledge notes** in Draft Studio and choose
**Generate three drafts**. This makes one new Generation using indexed notes as
supporting context and may incur retrieval and provider costs.

If a Generation already exists, opening it loads the saved result. Generations
are reused; selecting the knowledge option does not regenerate an existing
Generation.

### 3. Inspect supporting sources

Under a generated variation, select a supporting-source reference. The inline
**Current source** panel fetches the latest source and shows its title,
content version, and plain-text content. A version-mismatch notice means the
current source changed after generation. This is not a historical snapshot:
the citation identifies the version used during generation, while the panel
shows the current source. References indicate provenance, not factual
verification.

If a source was deleted, the panel explains that it is no longer available;
the saved draft and citation remain unchanged.

### 4. Review, edit, and approve

Read the human-review notice and use **Edit** when needed. Saving an edit
replaces the studio state with the server response and clears that variation's
supporting references, approval, and planned date. It does not change sibling
variations. After review, choose **Approve** for the variation you want to
keep.

### 5. Recover uncertain outcomes

If a generation or mutation request times out or reports an uncertain
outcome, do not immediately repeat a paid operation. Use **Check for saved
drafts**, or open the **Drafts** tab and choose **Open in Draft Studio** to
look for the persisted result.

### 6. Browse drafts and plan manually

The **Drafts** tab is owner-scoped and paginated. Use **Copy draft** to copy
only saved draft content. For an approved variation, enter a future local
date and time and choose **Add to calendar**. Calendar dates are manual
publishing plans; nothing publishes automatically.

Use the **Calendar** tab to inspect planned items and **Remove from calendar**
to clear a plan. Approval and scheduling preserve any remaining references.
In Draft Studio, choose **Download Markdown** beside **Copy draft** to
download the saved variation as a UTF-8 Markdown file. The export includes
the Signal topic, variation/status metadata, saved content, planned date when
present, and supporting-reference metadata. It does not contain a historical
source snapshot; references identify provenance and the source text may have
changed since generation.

## What is happening under the hood

The Next.js app talks to the Express API through the shared browser client.
The API authenticates the HTTP-only cookie, verifies ownership, stores notes,
Signals, Generations, and citations in MongoDB, and calls FastAPI for
explicit indexing, retrieval, and new generation work. FastAPI validates
structured provider output before the API persists it. Draft, source, and
calendar queries return public owner-filtered projections; the browser never
connects directly to MongoDB.

## Screenshot checklist

Capture screenshots only from your own local run. Suggested checkpoints:

- signed-in dashboard with the saved sample Signal;
- Draft Studio showing the reviewed variation and human-review notice;
- Drafts library with the Approved filter and Generation updated label;
- Draft Studio showing a saved planned date and the manual-publishing note;
- Calendar month agenda with the planned item;
- successful Copy draft feedback.

Do not claim a screenshot exists unless you captured it. Avoid including
email addresses, tokens, API keys, database URLs, or private draft content.

## Current limitations

- Calendar dates are reminders for manual publishing; there is no automatic
  publishing, scheduler, notification, or completed state.
- File uploads, GitHub ingestion, autonomous agents, and publishing
  automation are future work and are not demonstrated here.
- Editing clears source references, approval, and the planned date together
  for the edited variation.
- Scheduled counts include approved variations with past planned dates until
  they are removed.
- References indicate provenance, not factual verification. Current-source
  inspection is not a historical snapshot.
- Indexing, retrieval, and generation may incur provider costs.
- The local generation duplicate guard is process-local; it is not distributed
  coordination for multiple API instances.
