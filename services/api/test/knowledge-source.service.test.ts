import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import {
  createKnowledgeSourceForUser,
  deleteKnowledgeSourceForUser,
  getKnowledgeSourceForUser,
  listKnowledgeSourcesForUser,
  updateKnowledgeSourceForUser,
} from "../src/services/knowledge-source.service.js";
import {
  createKnowledgeSourceSchema,
  knowledgeSourceParamsSchema,
  listKnowledgeSourcesQuerySchema,
  updateKnowledgeSourceSchema,
} from "../src/validation/knowledge-source.validation.js";

const ownerId = "507f1f77bcf86cd799439011";
const otherOwnerId = "507f1f77bcf86cd799439012";
const sourceId = new Types.ObjectId("507f1f77bcf86cd799439013");
const createdAt = new Date("2030-01-01T00:00:00.000Z");

function source(owner: string = ownerId, overrides: Record<string, unknown> = {}) {
  return {
    _id: sourceId,
    ownerId: new Types.ObjectId(owner),
    title: "  Architecture notes  ",
    content: "  A sufficiently long source note.  ",
    contentVersion: 1,
    processingStatus: "pending" as const,
    processingErrorCode: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

test("knowledge source validation trims boundaries and rejects unknown input", () => {
  const valid = createKnowledgeSourceSchema.safeParse({
    title: "  A  ",
    content: "  1234567890  ",
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.deepEqual(valid.data, { title: "A", content: "1234567890" });
  }
  assert.equal(
    createKnowledgeSourceSchema.safeParse({ title: "A", content: "123456789" }).success,
    false,
  );
  assert.equal(
    createKnowledgeSourceSchema.safeParse({ title: "A", content: "1234567890", ownerId }).success,
    false,
  );
  assert.equal(
    createKnowledgeSourceSchema.safeParse({
      title: "A".repeat(121),
      content: "1234567890",
    }).success,
    false,
  );
  assert.deepEqual(
    updateKnowledgeSourceSchema.parse({
      title: "  Updated  ",
      content: "  Updated content is long enough.  ",
      expectedContentVersion: 1,
    }),
    {
      title: "Updated",
      content: "Updated content is long enough.",
      expectedContentVersion: 1,
    },
  );
  assert.equal(
    updateKnowledgeSourceSchema.safeParse({
      title: "Updated",
      content: "Updated content is long enough.",
      expectedContentVersion: 0,
    }).success,
    false,
  );
  assert.equal(
    updateKnowledgeSourceSchema.safeParse({
      title: "Updated",
      content: "Updated content is long enough.",
      expectedContentVersion: "1",
    }).success,
    false,
  );
  assert.equal(
    updateKnowledgeSourceSchema.safeParse({
      title: "Updated",
      content: "Updated content is long enough.",
      expectedContentVersion: 1,
      ownerId,
    }).success,
    false,
  );
});

test("knowledge source query and parameter validation are strict", () => {
  assert.deepEqual(
    listKnowledgeSourcesQuerySchema.parse({}),
    { page: 1, limit: 20 },
  );
  assert.equal(
    listKnowledgeSourcesQuerySchema.safeParse({ processingStatus: "unknown" }).success,
    false,
  );
  assert.deepEqual(
    listKnowledgeSourcesQuerySchema.parse({ processingStatus: "indexed" }),
    { page: 1, limit: 20, processingStatus: "indexed" },
  );
  assert.equal(
    listKnowledgeSourcesQuerySchema.safeParse({ page: "0" }).success,
    false,
  );
  assert.equal(
    listKnowledgeSourcesQuerySchema.safeParse({ limit: "51" }).success,
    false,
  );
  assert.equal(
    listKnowledgeSourcesQuerySchema.safeParse({ ownerId }).success,
    false,
  );
  assert.equal(
    knowledgeSourceParamsSchema.safeParse({ sourceId: sourceId.toString() }).success,
    true,
  );
  assert.equal(
    knowledgeSourceParamsSchema.safeParse({ sourceId: "not-an-id" }).success,
    false,
  );
});

test("knowledge source creation defaults to version one and pending", async () => {
  const calls: unknown[] = [];
  const repository = {
    createKnowledgeSource: async (...args: unknown[]) => {
      calls.push(args);
      return source();
    },
    findKnowledgeSourcesByOwner: async () => [],
    countKnowledgeSourcesByOwner: async () => 0,
    findKnowledgeSourceByIdAndOwner: async () => null,
    deleteKnowledgeSourceByIdAndOwner: async () => null,
    deleteKnowledgeSourceByIdAndOwnerIfNotIndexing: async () => null,
    findKnowledgeSourceForIndexing: async () => null,
    claimKnowledgeSourceIndexing: async () => null,
    finalizeKnowledgeSourceIndexing: async () => null,
  };

  const result = await createKnowledgeSourceForUser(
    ownerId,
    { title: "Architecture notes", content: "A sufficiently long source note." },
    repository,
  );
  assert.deepEqual(calls, [[ownerId, { title: "Architecture notes", content: "A sufficiently long source note." }]]);
  assert.equal(result.contentVersion, 1);
  assert.equal(result.processingStatus, "pending");
  assert.deepEqual(Object.keys(result).sort(), [
    "content",
    "contentVersion",
    "createdAt",
    "id",
    "processingStatus",
    "title",
    "updatedAt",
  ]);
});

test("knowledge source listing is owner-scoped and uses empty totalPages", async () => {
  const calls: unknown[] = [];
  const repository = {
    createKnowledgeSource: async () => source(),
    findKnowledgeSourcesByOwner: async (...args: unknown[]) => {
      calls.push(["list", ...args]);
      return [source()];
    },
    countKnowledgeSourcesByOwner: async (...args: unknown[]) => {
      calls.push(["count", ...args]);
      return 0;
    },
    findKnowledgeSourceByIdAndOwner: async () => null,
    deleteKnowledgeSourceByIdAndOwner: async () => null,
    deleteKnowledgeSourceByIdAndOwnerIfNotIndexing: async () => null,
    findKnowledgeSourceForIndexing: async () => null,
    claimKnowledgeSourceIndexing: async () => null,
    finalizeKnowledgeSourceIndexing: async () => null,
  };

  const result = await listKnowledgeSourcesForUser(
    ownerId,
    { page: 2, limit: 1, processingStatus: "indexed" },
    repository,
  );
  assert.deepEqual(result.pagination, { page: 2, limit: 1, total: 0, totalPages: 0 });
  assert.deepEqual(calls, [
    ["list", ownerId, { page: 2, limit: 1, processingStatus: "indexed" }],
    ["count", ownerId, { page: 2, limit: 1, processingStatus: "indexed" }],
  ]);
});

test("knowledge source get and delete hide cross-owner resources", async () => {
  const repository = {
    createKnowledgeSource: async () => source(),
    findKnowledgeSourcesByOwner: async () => [],
    countKnowledgeSourcesByOwner: async () => 0,
    findKnowledgeSourceByIdAndOwner: async () => null,
    deleteKnowledgeSourceByIdAndOwner: async () => null,
    deleteKnowledgeSourceByIdAndOwnerIfNotIndexing: async () => null,
    findKnowledgeSourceForIndexing: async () => null,
    claimKnowledgeSourceIndexing: async () => null,
    finalizeKnowledgeSourceIndexing: async () => null,
  };

  await assert.rejects(
    getKnowledgeSourceForUser(otherOwnerId, sourceId.toString(), repository),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "SOURCE_NOT_FOUND" &&
      error.message === "Knowledge source not found",
  );
  await assert.rejects(
    deleteKnowledgeSourceForUser(otherOwnerId, sourceId.toString(), repository),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "SOURCE_NOT_FOUND" &&
      error.message === "Knowledge source not found",
  );
});

test("knowledge source deletion passes both owner and source ID atomically", async () => {
  const calls: unknown[] = [];
  const repository = {
    createKnowledgeSource: async () => source(),
    findKnowledgeSourcesByOwner: async () => [],
    countKnowledgeSourcesByOwner: async () => 0,
    findKnowledgeSourceByIdAndOwner: async () => null,
    deleteKnowledgeSourceByIdAndOwner: async (...args: unknown[]) => {
      calls.push(args);
      return source();
    },
    deleteKnowledgeSourceByIdAndOwnerIfNotIndexing: async (...args: unknown[]) => {
      calls.push(["lease-aware", ...args]);
      return source();
    },
    findKnowledgeSourceForIndexing: async () => null,
    claimKnowledgeSourceIndexing: async () => null,
    finalizeKnowledgeSourceIndexing: async () => null,
  };

  await deleteKnowledgeSourceForUser(ownerId, sourceId.toString(), repository);
  assert.deepEqual(calls, [["lease-aware", ownerId, sourceId.toString()]]);
});

test("source edits use owner and expected version, incrementing and resetting indexing state", async () => {
  const calls: unknown[] = [];
  const updated = source(ownerId, {
    title: "Updated title",
    content: "Updated content is long enough.",
    contentVersion: 2,
    processingStatus: "pending",
    processingErrorCode: null,
    indexingAttemptId: null,
    indexingLeaseExpiresAt: null,
    indexedContentVersion: null,
    indexedChunkerVersion: null,
    indexedEmbeddingModel: null,
    indexedDimensions: null,
    indexedChunkCount: null,
  });
  const repository = {
    createKnowledgeSource: async () => source(),
    findKnowledgeSourcesByOwner: async () => [],
    countKnowledgeSourcesByOwner: async () => 0,
    findKnowledgeSourceByIdAndOwner: async () => null,
    updateKnowledgeSourceIfVersionAndLeaseAvailable: async (...args: unknown[]) => {
      calls.push(args);
      return updated;
    },
    deleteKnowledgeSourceByIdAndOwner: async () => null,
    deleteKnowledgeSourceByIdAndOwnerIfNotIndexing: async () => null,
    findKnowledgeSourceForIndexing: async () => null,
    claimKnowledgeSourceIndexing: async () => null,
    finalizeKnowledgeSourceIndexing: async () => null,
  };
  const now = new Date("2030-01-01T00:00:05.000Z");

  const result = await updateKnowledgeSourceForUser(
    ownerId,
    sourceId.toString(),
    {
      title: "Updated title",
      content: "Updated content is long enough.",
      expectedContentVersion: 1,
    },
    repository,
    () => now,
  );

  assert.deepEqual(calls, [[
    ownerId,
    sourceId.toString(),
    {
      title: "Updated title",
      content: "Updated content is long enough.",
      expectedContentVersion: 1,
    },
    now,
  ]]);
  assert.equal(result.contentVersion, 2);
  assert.equal(result.processingStatus, "pending");
});

test("source edit conflicts distinguish stale versions, active failed leases, and missing owners", async () => {
  const input = {
    title: "Updated title",
    content: "Updated content is long enough.",
    expectedContentVersion: 1,
  };
  const baseRepository = {
    createKnowledgeSource: async () => source(),
    findKnowledgeSourcesByOwner: async () => [],
    countKnowledgeSourcesByOwner: async () => 0,
    findKnowledgeSourceByIdAndOwner: async () => null,
    updateKnowledgeSourceIfVersionAndLeaseAvailable: async () => null,
    deleteKnowledgeSourceByIdAndOwner: async () => null,
    deleteKnowledgeSourceByIdAndOwnerIfNotIndexing: async () => null,
    claimKnowledgeSourceIndexing: async () => null,
    finalizeKnowledgeSourceIndexing: async () => null,
  };
  const now = new Date("2030-01-01T00:00:05.000Z");

  await assert.rejects(
    updateKnowledgeSourceForUser(
      ownerId,
      sourceId.toString(),
      input,
      {
        ...baseRepository,
        findKnowledgeSourceForIndexing: async () => source(ownerId, { contentVersion: 2 }),
      },
      () => now,
    ),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "SOURCE_VERSION_CONFLICT",
  );
  await assert.rejects(
    updateKnowledgeSourceForUser(
      ownerId,
      sourceId.toString(),
      input,
      {
        ...baseRepository,
        findKnowledgeSourceForIndexing: async () =>
          source(ownerId, {
            processingStatus: "failed",
            indexingLeaseExpiresAt: new Date("2030-01-01T00:01:00.000Z"),
          }),
      },
      () => now,
    ),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "SOURCE_INDEXING_IN_PROGRESS",
  );
  await assert.rejects(
    updateKnowledgeSourceForUser(ownerId, otherOwnerId, input, {
      ...baseRepository,
      findKnowledgeSourceForIndexing: async () => null,
    }, () => now),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "SOURCE_NOT_FOUND",
  );
});

test("unchanged source edits preserve the current status and version", async () => {
  const current = source(ownerId, {
    title: "Updated title",
    content: "Updated content is long enough.",
    contentVersion: 4,
    processingStatus: "indexed",
  });
  let updateCalls = 0;
  const repository = {
    createKnowledgeSource: async () => current,
    findKnowledgeSourcesByOwner: async () => [],
    countKnowledgeSourcesByOwner: async () => 0,
    findKnowledgeSourceByIdAndOwner: async () => null,
    updateKnowledgeSourceIfVersionAndLeaseAvailable: async () => {
      updateCalls += 1;
      return current;
    },
    deleteKnowledgeSourceByIdAndOwner: async () => null,
    deleteKnowledgeSourceByIdAndOwnerIfNotIndexing: async () => null,
    findKnowledgeSourceForIndexing: async () => current,
    claimKnowledgeSourceIndexing: async () => null,
    finalizeKnowledgeSourceIndexing: async () => null,
  };

  const result = await updateKnowledgeSourceForUser(
    ownerId,
    sourceId.toString(),
    {
      title: "Updated title",
      content: "Updated content is long enough.",
      expectedContentVersion: 4,
    },
    repository,
  );

  assert.equal(updateCalls, 1);
  assert.equal(result.contentVersion, 4);
  assert.equal(result.processingStatus, "indexed");
});
