# Personal RAG Architecture & Implementation Plan

This document defines the architectural plan for introducing **Personal RAG**
(Retrieval-Augmented Generation) into DevSignal AI. The goal of Personal RAG is
to ground generated personal-branding drafts in a developer's verified
knowledge and experiences, preventing hallucinated claims and enabling
accurate, verifiable citations.

The initial implementation slice is strictly limited to **user-submitted text
notes**. Complex document ingestion (such as PDF parsing) and third-party
connectors (such as GitHub repository scanning) are deferred to subsequent
phases once the core text ingestion, vector indexing, and grounded retrieval
loop is proven and tested.

---

## 1. Scope & System Boundaries

### Approved MVP Baseline (Current State)
The existing system provides:
- Authenticated Signals (topic, notes, audience, content type).
- Generation of three draft variations per Signal via FastAPI and OpenAI.
- In-memory duplicate-generation guards for one active generation per Signal.
- Draft editing (which resets status to `draft` and clears scheduling).
- Draft approval and owner-scoped Drafts library.
- Manual Content Calendar with UTC date/time planning and Scheduled metric.
- Plain-text clipboard copying.

### Personal RAG Scope (Target State)
- **Knowledge Sources:** Owner-scoped text notes created, viewed, and managed
  by the authenticated developer.
- **Persistent Source Storage:** MongoDB collection storing raw text, metadata,
  content version, and processing status.
- **Chunking & Vector Indexing:** Structured text chunking with stable chunk
  identifiers, embedded and stored in Qdrant with owner and version metadata.
- **Mandatory Owner Filtering:** All vector searches strictly enforced with
  the authenticated `ownerId`.
- **Grounded Generation:** Prompting the LLM with retrieved relevant chunks as
  untrusted reference data and returning structured citations.
- **Source Citation UI:** Displaying verifiable source snippets alongside draft
  variations in Draft Studio.

### Explicitly Deferred
- PDF, Markdown, or binary document file uploads.
- GitHub repository, pull request, or commit ingestion.
- Automated web scraping or external URL ingestion.
- Multi-modal embeddings.
- Automatic background polling or third-party webhooks.

---

## 2. Knowledge Source Storage (MongoDB)

Knowledge sources are authoritative records owned by a single developer. They
are stored in MongoDB under `services/api` before any chunking or vectorization
occurs.

### Document Schema (`sources` Collection)

| Field | Type | Description | Constraints |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Unique source identifier | Auto-generated |
| `ownerId` | `ObjectId` | Reference to authenticated User | Required, indexed |
| `title` | `String` | Human-readable title of the note | Required, 1–120 characters, trimmed |
| `content` | `String` | Raw text note content | Required, 10–20,000 characters |
| `contentVersion` | `Number` | Monotonically increasing version counter | Integer &ge; 1, defaults to 1 |
| `processingStatus` | `String` | Current indexing state | Enum: `pending`, `indexing`, `indexed`, `failed` |
| `errorMessage` | `String \| null` | Sanitized error code if indexing failed | Null or max 200 characters |
| `createdAt` | `Date` | Record creation timestamp | UTC Date |
| `updatedAt` | `Date` | Last modification timestamp | UTC Date |

### Indexes
- `{ ownerId: 1, createdAt: -1 }`: Efficient owner-scoped paginated listing.
- `{ ownerId: 1, processingStatus: 1 }`: Quick status queries and retry workers.

---

## 3. Proposed API Contracts (`services/api`)

All source endpoints require HTTP-only cookie authentication. The Express API
enforces strict request validation (using Zod), strips unknown fields, and
never accepts `ownerId` from the client request body or query parameters.

### `POST /api/v1/sources`
Create a new text knowledge source.

- **Request Body:**
  ```json
  {
    "title": "Migrating to Event-Driven Architecture",
    "content": "In Q3 we migrated our monolithic order service to Kafka-based events..."
  }
  ```
- **Validation:**
  - `title`: String, min 1, max 120 chars, trimmed.
  - `content`: String, min 10, max 20,000 chars.
  - Reject unknown properties.
- **Response (HTTP 201):**
  ```json
  {
    "id": "65f1a2b3c4d5e6f7a8b9c0d1",
    "title": "Migrating to Event-Driven Architecture",
    "contentVersion": 1,
    "processingStatus": "pending",
    "contentLength": 84,
    "createdAt": "2026-09-12T10:00:00.000Z",
    "updatedAt": "2026-09-12T10:00:00.000Z"
  }
  ```

### `GET /api/v1/sources`
List owner-scoped knowledge sources with pagination.

- **Query Parameters:**
  - `page`: Integer &ge; 1 (default `1`).
  - `limit`: Integer between 1 and 50 (default `20`).
- **Response (HTTP 200):**
  ```json
  {
    "items": [
      {
        "id": "65f1a2b3c4d5e6f7a8b9c0d1",
        "title": "Migrating to Event-Driven Architecture",
        "contentVersion": 1,
        "processingStatus": "indexed",
        "contentLength": 84,
        "createdAt": "2026-09-12T10:00:00.000Z",
        "updatedAt": "2026-09-12T10:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
  ```

### `GET /api/v1/sources/:sourceId`
Retrieve a single knowledge source, including its full text content.

- **Parameters:** `sourceId` (valid 24-char hexadecimal string).
- **Security:** Verifies `ownerId == req.user.id`. Missing or unowned sources
  return 404.
- **Response (HTTP 200):**
  ```json
  {
    "id": "65f1a2b3c4d5e6f7a8b9c0d1",
    "title": "Migrating to Event-Driven Architecture",
    "content": "In Q3 we migrated our monolithic order service to Kafka-based events...",
    "contentVersion": 1,
    "processingStatus": "indexed",
    "errorMessage": null,
    "createdAt": "2026-09-12T10:00:00.000Z",
    "updatedAt": "2026-09-12T10:00:00.000Z"
  }
  ```

### `DELETE /api/v1/sources/:sourceId`
Delete a knowledge source and invalidate its indexed vector chunks.

- **Parameters:** `sourceId` (valid 24-char hexadecimal string).
- **Behavior:**
  1. Atomically removes the MongoDB document matching `_id` and `ownerId`.
  2. Emits an invalidation command to delete all corresponding points in Qdrant
     matching `ownerId` and `sourceId`.
- **Response (HTTP 200):**
  ```json
  {
    "message": "Knowledge source deleted successfully"
  }
  ```

---

## 4. Pipeline Separation & Architecture

The ingestion and retrieval workflows are cleanly decoupled into five
distinct, verifiable stages:

```
[User Note] 
     │
     ▼ (1. Source Storage - Express + MongoDB)
[MongoDB: Source Record (pending)]
     │
     ▼ (2. Chunking - Deterministic Splitting)
[Text Chunks + Stable Chunk IDs]
     │
     ▼ (3. Embedding - Vector Generation)
[Embedding Vectors]
     │
     ▼ (4. Vector Indexing - Qdrant with Metadata)
[Qdrant Collection (points with ownerId, sourceId, version)]
     │
     ▼ (5. Retrieval & Grounding - FastAPI + OpenAI)
[Prompt with Untrusted Chunks] ──► [Draft Variations + Citations]
```

### 1. Source Storage (Express API)
Authoritative CRUD management in MongoDB. The API stores user text notes,
tracks `processingStatus`, increments `contentVersion` on edits, and coordinates
downstream indexing.

### 2. Chunking
Deterministic text partitioning into bounded character/token windows with
configurable overlap (e.g. 500 characters with 50-character overlap).
Each chunk receives a deterministic, stable identifier:
`{sourceId}_v{contentVersion}_c{chunkIndex}`.

### 3. Embedding (AI Service)
Generates dense vector embeddings for each chunk using an embedding model.
Embedding calls are isolated within `services/ai` or dedicated embedding
utilities.

### 4. Vector Indexing (Qdrant)
Points are inserted into a dedicated Qdrant collection (e.g. `personal_knowledge`).
Every point stores payload metadata:
```json
{
  "chunkId": "65f1a2b3c4d5e6f7a8b9c0d1_v1_c0",
  "ownerId": "65e0123456789abcdef01234",
  "sourceId": "65f1a2b3c4d5e6f7a8b9c0d1",
  "contentVersion": 1,
  "chunkIndex": 0,
  "title": "Migrating to Event-Driven Architecture",
  "text": "In Q3 we migrated our monolithic order service..."
}
```
Payload indexes are configured on `ownerId` (keyword), `sourceId` (keyword), and
`contentVersion` (integer).

### 5. Retrieval & Grounded Generation
When generating drafts for a Signal:
1. The AI service queries Qdrant with the Signal's topic and notes as the query text.
2. **Mandatory Owner Filter:** The query filter strictly enforces:
   `must: [{ key: "ownerId", match: { value: ownerId } }]`.
3. The top-K relevant chunks (above a minimum similarity threshold) are retrieved.
4. Chunks are passed into the prompt as untrusted reference context.
5. The model outputs draft variations referencing the specific chunk IDs used.

---

## 5. Security, Invalidation & Safe Failure Handling

### Mandatory Owner Isolation
Cross-tenant data leakage is prevented at the database query level:
- MongoDB queries always include `{ ownerId: req.user.id }`.
- Qdrant vector searches MUST require an `ownerId` match condition. Unfiltered
  vector scans are strictly prohibited.
- `ownerId` is derived exclusively from verified JWT authentication cookies.

### Untrusted Content Framing
Retrieved chunks from user notes must be treated as **untrusted data**, never
as system instructions. The generation prompt must use clear delimiters (e.g.
`<knowledge_source id="...">...</knowledge_source>`) and explicit system rules
mandating that knowledge text cannot override safety boundaries or instructions.

### Privacy & Logging Rules
- Raw source text, note content, and vector embeddings must NEVER be written to
  application logs or standard output.
- Log only sanitized metadata: `ownerId`, `sourceId`, `chunkCount`, and status.
- Never log OpenAI API keys, internal service keys, or database credentials.

### Stale Chunk Invalidation
- **On Source Update:** When a note is edited, `contentVersion` is incremented.
  Existing chunks for that `sourceId` in Qdrant are deleted by filter before or
  during upsert of the new version.
- **On Source Deletion:** Deleting a source issues a Qdrant point deletion
  filtered by `ownerId` and `sourceId`.

### Failure Handling & Safe Retries
- Failures during embedding or Qdrant insertion update the MongoDB source
  record to `processingStatus: "failed"` with a safe error code.
- Operations must be idempotent. Retrying indexing for a source deletes existing
  points for that `sourceId` and inserts fresh points.
- The system does not claim distributed "exactly-once" processing; it guarantees
  eventual consistency through versioned upserts.

---

## 6. Interaction with Existing Signal & Generation Model

### Current Behavior
- A Signal represents a single concept with topic, notes, audience, and content
  type.
- A Signal has at most one Generation containing exactly three draft variations.
- Concurrent generation requests for the same Signal are blocked by an
  in-memory in-flight guard.
- Once created, variations can be edited, approved, scheduled, or copied.

### Grounding Integration
- When Personal RAG is enabled, the generation request retrieves relevant
  chunks from the user's indexed knowledge sources.
- Grounded draft variations will include a `sourceCitations` array containing
  the referenced `sourceId`, `chunkId`, and `title`.
- **Regeneration vs. Immutability Decision:**
  If a user updates a knowledge source after a Generation was already created:
  - Existing approved and scheduled drafts MUST remain unchanged (immutable
    historical records).
  - An explicit future decision is required on whether to allow "Regenerate
    with updated knowledge" (which would replace or version the unapproved draft
    variations).
  - The existing one-Generation-per-Signal contract must not be altered silently.

---

## 7. Bounded Implementation Checkpoints

Implementation will proceed in five isolated, testable checkpoints:

### Checkpoint 1: Knowledge-Source CRUD API (`services/api`)
- Create Mongoose `Source` model with `ownerId`, `title`, `content`, `contentVersion`, and `processingStatus`.
- Implement Zod validation schemas for source creation and queries.
- Build controller, repository, and routes (`POST`, `GET`, `GET :id`, `DELETE`).
- Add comprehensive unit and integration tests for authentication, strict input validation, owner isolation, and missing-resource safety.

### Checkpoint 2: Knowledge-Source Dashboard UI (`apps/web`)
- Add a new **Knowledge** / **Sources** navigation tab on the dashboard.
- Build a note creation modal/form with client-side character length validation.
- Implement a paginated list showing source title, processing status badge, created date, and delete action.
- Implement note view/inspection modal.
- Connect to shared API client with error handling, loading states, and optimistic mutation guards.

### Checkpoint 3: Chunking, Embeddings, and Qdrant Indexing (`services/ai` + Qdrant)
- Define deterministic text chunking logic with stable chunk IDs.
- Configure Qdrant client, collection schema, and payload indexes (`ownerId`, `sourceId`, `contentVersion`).
- Implement indexing service that takes raw source text, creates chunks, computes embeddings, and upserts points to Qdrant.
- Add unit tests with fake embedding vectors and mocked Qdrant client.

### Checkpoint 4: Owner-Scoped Retrieval and Grounded Generation (`services/api` + `services/ai`)
- Extend the AI generation request payload to support optional knowledge grounding.
- Implement Qdrant vector search with mandatory `ownerId` filtering.
- Update AI prompt templates to format retrieved chunks as delimited untrusted reference context.
- Update Pydantic structured output models to require `sourceCitations` on variations.
- Add unit tests verifying prompt assembly, owner filter enforcement, and citation validation.

### Checkpoint 5: Visible Source References and Verification (`apps/web` + `services/api`)
- Update Draft Studio and Drafts library to render citation chips linking back to referenced knowledge sources.
- Add human-review indicators highlighting which claims are grounded vs. generated.
- Update demo guide and documentation with a grounded generation walkthrough.

---

## 8. Open Architectural Decisions

The following technical decisions are intentionally left open and must be
resolved in their respective checkpoints before implementation:

1. **Embedding Model Selection:** Choice of model (e.g. `text-embedding-3-small`
   vs. alternative providers) and vector dimensionality (e.g. 1536).
2. **Qdrant Service Provisioning:** Local Docker Compose configuration
   (`docker-compose.yml`) for Qdrant service container, storage volume, and
   health check endpoints.
3. **Ingestion Orchestration:** Synchronous endpoint execution vs. lightweight
   background processing worker (evaluating whether Phase 3 Redis/BullMQ is
   needed or if internal async tasks suffice for text notes).
4. **Chunking Parameters:** Final character window size (e.g. 500 chars),
   overlap size (e.g. 50 chars), and splitting boundary heuristics (paragraph
   vs sentence splitting).
5. **Retrieval Scoring & Top-K:** Default number of chunks retrieved per
   Signal (e.g. K=3 to K=5) and minimum cosine similarity threshold.
6. **Signal-to-Source Association:** Whether retrieval is purely semantic based
   on Signal text, or if users can explicitly tag/select specific sources to
   ground a Signal.
7. **Regeneration Policy:** How to handle existing drafts when underlying
   knowledge sources are edited or deleted.
