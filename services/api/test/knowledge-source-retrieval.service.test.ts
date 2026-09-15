import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import type { AiRetrievalCandidate } from "../src/clients/retrieval.types.js";
import {
  searchKnowledgeSourcesForUser,
  type RetrievalRepositoryBoundary,
} from "../src/services/knowledge-source-retrieval.service.js";

const ownerId = "507f1f77bcf86cd799439011";
const sourceId = "507f1f77bcf86cd799439012";
const otherSourceId = "507f1f77bcf86cd799439013";

function candidate(overrides: Partial<AiRetrievalCandidate> = {}): AiRetrievalCandidate {
  return {
    pointId: "point-1",
    ownerId,
    sourceId,
    contentVersion: 2,
    chunkerVersion: "text-v1",
    chunkIndex: 0,
    chunkId: `${sourceId}_v2_c0`,
    text: "Fix 🚀\nready",
    startOffset: 0,
    endOffset: 11,
    embeddingModel: "text-embedding-3-small",
    score: 0.9,
    ...overrides,
  };
}

function source(id = sourceId, overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(id),
    ownerId: new Types.ObjectId(ownerId),
    title: "Current title",
    content: "Fix 🚀\r\nready",
    contentVersion: 2,
    processingStatus: "indexed" as const,
    indexedContentVersion: 2,
    indexedChunkerVersion: "text-v1",
    indexedEmbeddingModel: "text-embedding-3-small",
    indexedDimensions: 1536,
    ...overrides,
  };
}

function repository(sources: ReturnType<typeof source>[]): RetrievalRepositoryBoundary {
  return {
    findKnowledgeSourcesByIdsAndOwner: async () => sources,
  };
}

test("validates Unicode code-point offsets and normalizes CRLF", async () => {
  const results = await searchKnowledgeSourcesForUser(
    ownerId,
    "fix",
    5,
    { retrieve: async () => [candidate()] },
    repository([source()]),
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.text, "Fix 🚀\nready");
  assert.equal(results[0]?.title, "Current title");
});

test("filters cross-owner, stale, deleted, non-indexed, and duplicate candidates", async () => {
  const results = await searchKnowledgeSourcesForUser(
    ownerId,
    "fix",
    5,
    {
      retrieve: async () => [
        candidate({ ownerId: "507f1f77bcf86cd799439099" }),
        candidate({ pointId: "duplicate" }),
        candidate({ pointId: "stale", contentVersion: 1, chunkId: `${sourceId}_v1_c0` }),
        candidate({ pointId: "other", sourceId: otherSourceId, chunkId: `${otherSourceId}_v2_c0` }),
      ],
    },
    repository([
      source(),
      source(otherSourceId, { processingStatus: "pending" }),
    ]),
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.chunkId, `${sourceId}_v2_c0`);
});

test("allows fewer results and preserves ranking after validation", async () => {
  const results = await searchKnowledgeSourcesForUser(
    ownerId,
    "fix",
    2,
    {
      retrieve: async () => [
        candidate({ pointId: "bad", text: "not the source" }),
        candidate({ pointId: "good", score: 0.8 }),
      ],
    },
    repository([source()]),
  );

  assert.deepEqual(results.map((result) => result.score), [0.8]);
});
