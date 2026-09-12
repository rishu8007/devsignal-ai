# DevSignal AI MVP demo

This walkthrough takes about 5–7 minutes once MongoDB, the API, the AI
service, and the web app are running. It demonstrates the current
human-reviewed workflow. Use a test account and never paste real credentials
or secrets into the demo.

## Before you start

Open `http://localhost:3000`. If you need an account, choose **Create one**
and register with a test email and password, then sign in. Keep the browser
and API on consistent `localhost` hostnames so the HTTP-only cookie session
works as expected.

Live generation requires a valid OpenAI key and may incur usage costs. To
demonstrate the UI without another provider request, use the existing-draft
route in the next section.

## End-to-end path

### 1. Save a Signal

On the **Create** tab, use this realistic sample:

- **Topic or feature:** `Added request tracing to our API`
- **Learning notes:** `I added request tracing to our Express API with a
  correlation ID carried through middleware and database calls. The main
  lesson was to make the ID visible in every error response and log context
  without logging request payloads or credentials.`
- **Content type:** `Technical insight`
- **Primary audience:** `Developers & engineers`

Choose **Save signal**. The Signal is stored under your account and becomes
available in Recent Signals.

### 2. Generate drafts

Choose **Generate three variations** on the Recent Signal card (or **Generate three drafts** in Draft Studio) for the saved Signal. The API sends the owned Signal
content to the FastAPI service and stores three meaningfully different
variations. Open the resulting Draft Studio view.

**Existing-draft route (no paid generation):** if your account already has a
saved draft, select the **Drafts** tab instead, choose **Open in Draft
Studio**, and continue at the review step. This route loads the persisted
Signal and Generation by ID and does not call the generation endpoint. If the
account has no draft yet, stop after saving the Signal or use a test provider
environment before generating.

### 3. Review and edit

In Draft Studio, inspect the three saved variations. Select one, read the
human-review notice, and use **Edit** to change its content. Save the edit,
then confirm the server response is reflected in the studio.

Editing is intentionally a safety boundary: it resets that variation to
**Draft** and clears any planned calendar date. It does not change sibling
variations.

### 4. Approve

After reviewing the content, choose **Approve** for the variation you want to
keep. Approval is scoped to that saved variation. Approval alone does not
schedule or publish anything.

### 5. Browse the Drafts library

Open the **Drafts** tab. Try **All**, **Draft**, and **Approved** filters.
The library is owner-scoped, paginated, and shows the saved topic, readable
angle, status, content, and **Generation updated** timestamp. Use **Copy
draft** to copy only the persisted content; paragraph breaks are preserved.

### 6. Plan a calendar date

Return to Draft Studio for the approved variation. Enter a future local date
and time in the separately labeled controls, then choose **Add to calendar**
(or **Change planned date** for an existing plan). The UI sends the local
selection as a UTC timestamp and shows the saved value in your local
timezone.

This is a manual publishing plan only. Nothing publishes automatically, and
past planned dates remain in the Scheduled metric until removed. Use
**Remove from calendar** to clear the plan.

### 7. Open Calendar and copy

Open the **Calendar** tab. Use **Today**, **Previous month**, or **Next month**
to inspect the month agenda. Open the item in Draft Studio or choose **Copy
draft** directly from the calendar card. Calendar items are approved,
owner-scoped, and displayed in planned local date/time order.

## What is happening under the hood

The Next.js app talks to the Express API through the shared browser client.
The API authenticates the HTTP-only cookie, verifies Signal ownership, stores
Signals and embedded Generation variations in MongoDB, and calls FastAPI only
for a new generation. FastAPI validates structured provider output before the
API persists it. Draft library and calendar queries return public,
owner-filtered projections; the browser never connects directly to MongoDB.

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
- Editing clears approval and the planned date together.
- Scheduled counts include approved variations with past planned dates until
  they are removed.
- Generated claims can still require factual correction, so human review is
  required before use.
- The local generation duplicate guard is process-local; it is not distributed
  coordination for multiple API instances.
