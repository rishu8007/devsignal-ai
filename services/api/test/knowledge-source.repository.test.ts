import assert from "node:assert/strict";
import { test } from "node:test";
import { KnowledgeSourceModel } from "../src/models/knowledge-source.model.js";
import {
  claimKnowledgeSourceIndexing,
  countKnowledgeSourcesByOwner,
  findKnowledgeSourceForIndexing,
  findKnowledgeSourcesByOwner,
  updateKnowledgeSourceIfVersionAndLeaseAvailable,
} from "../src/repositories/knowledge-source.repository.js";

const ownerId = "507f1f77bcf86cd799439011";
const sourceId = "507f1f77bcf86cd799439012";

interface QueryStub {
  select(...args: unknown[]): QueryStub;
  sort(): QueryStub;
  skip(): QueryStub;
  limit(): QueryStub;
  lean<T>(): QueryStub;
  exec(): Promise<null | unknown[]>;
}

interface ModelStub {
  findOne(...args: unknown[]): QueryStub;
  findOneAndUpdate(...args: unknown[]): QueryStub;
  find(...args: unknown[]): QueryStub;
  countDocuments(...args: unknown[]): QueryStub;
}

test("source edit repository enables Mongoose update pipelines and literalizes user text", async () => {
  const model = KnowledgeSourceModel as unknown as ModelStub;
  const original = model.findOneAndUpdate;
  let captured: unknown[] | undefined;
  const query: QueryStub = {
    select: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    lean: () => query,
    exec: async () => null,
  };
  model.findOneAndUpdate = (...args: unknown[]) => {
    captured = args;
    return query;
  };

  try {
    const result = await updateKnowledgeSourceIfVersionAndLeaseAvailable(
      ownerId,
      sourceId,
      {
        title: "$title should stay text",
        content: "$content should stay text",
        expectedContentVersion: 3,
      },
      new Date("2030-01-01T00:00:05.000Z"),
    );

    assert.equal(result, null);
    assert.ok(captured);
    assert.equal(Array.isArray(captured[1]), true);
    assert.deepEqual(captured[2], {
      new: true,
      timestamps: false,
      updatePipeline: true,
    });
    const pipeline = captured[1] as Array<{ $set: Record<string, unknown> }>;
    assert.deepEqual(pipeline[0]?.$set.title, { $literal: "$title should stay text" });
    assert.deepEqual(pipeline[0]?.$set.content, { $literal: "$content should stay text" });
  } finally {
    model.findOneAndUpdate = original;
  }
});

test("source list repository applies owner and status filters to list and count", async () => {
  const model = KnowledgeSourceModel as unknown as ModelStub;
  const originalFind = model.find;
  const originalCount = model.countDocuments;
  const captured: unknown[][] = [];
  const query: QueryStub = {
    select: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    lean: () => query,
    exec: async () => [],
  };
  model.find = (...args: unknown[]) => {
    captured.push(["find", ...args]);
    return query;
  };
  model.countDocuments = (...args: unknown[]) => {
    captured.push(["count", ...args]);
    return query;
  };

  try {
    const listQuery = { page: 2, limit: 10, processingStatus: "failed" as const };
    await findKnowledgeSourcesByOwner(ownerId, listQuery);
    await countKnowledgeSourcesByOwner(ownerId, listQuery);
    assert.deepEqual(captured, [
      ["find", { ownerId, processingStatus: "failed" }],
      ["count", { ownerId, processingStatus: "failed" }],
    ]);
  } finally {
    model.find = originalFind;
    model.countDocuments = originalCount;
  }
});

test("indexing lookup selects status and content version for atomic claims", async () => {
  const model = KnowledgeSourceModel as unknown as ModelStub;
  const original = model.findOne;
  let capturedFilter: unknown;
  let capturedSelection: unknown;
  const query: QueryStub = {
    select: (...args: unknown[]) => {
      capturedSelection = args[0];
      return query;
    },
    sort: () => query,
    skip: () => query,
    limit: () => query,
    lean: () => query,
    exec: async () => null,
  };
  model.findOne = (...args: unknown[]) => {
    capturedFilter = args[0];
    return query;
  };

  try {
    await findKnowledgeSourceForIndexing(ownerId, sourceId);
    assert.deepEqual(capturedFilter, { _id: sourceId, ownerId });
    assert.equal(typeof capturedSelection, "string");
    assert.match(capturedSelection as string, /\bcontentVersion\b/);
    assert.match(capturedSelection as string, /\bprocessingStatus\b/);
  } finally {
    model.findOne = original;
  }
});

test("indexed stale embedding metadata is atomically claimable", async () => {
  const model = KnowledgeSourceModel as unknown as ModelStub;
  const original = model.findOneAndUpdate;
  const candidate = {
    processingStatus: "indexed",
    indexedEmbeddingModel: "text-embedding-3-small",
    indexedDimensions: 1536,
    indexingLeaseExpiresAt: null,
  };
  let captured: unknown[] | undefined;
  const query: QueryStub = {
    select: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    lean: () => query,
    exec: async () => candidate,
  };
  model.findOneAndUpdate = (...args: unknown[]) => {
    captured = args;
    return query;
  };

  try {
    const result = await claimKnowledgeSourceIndexing(
      ownerId,
      sourceId,
      1,
      "attempt-1",
      new Date("2030-01-01T00:10:00.000Z"),
      "gemini-embedding-2",
      1536,
    );
    const filter = captured?.[0] as {
      _id: string;
      ownerId: string;
      contentVersion: number;
      $or: Array<Record<string, unknown>>;
    };
    assert.equal(result, candidate);
    assert.deepEqual(
      (filter.$or[2] as { processingStatus: string }).processingStatus,
      "indexed",
    );
    const staleBranch = filter.$or[2] as {
      $and: [
        { $or: Array<Record<string, unknown>> },
        { $or: Array<Record<string, unknown>> },
      ];
    };
    assert.deepEqual(staleBranch.$and[0].$or, [
      { indexedEmbeddingModel: { $ne: "gemini-embedding-2" } },
      { indexedDimensions: { $ne: 1536 } },
    ]);
    assert.deepEqual(staleBranch.$and[1].$or[0], { indexingLeaseExpiresAt: null });
    assert.ok(
      staleBranch.$and[1].$or[1].indexingLeaseExpiresAt &&
        typeof staleBranch.$and[1].$or[1].indexingLeaseExpiresAt === "object" &&
        "$lte" in staleBranch.$and[1].$or[1].indexingLeaseExpiresAt &&
        staleBranch.$and[1].$or[1].indexingLeaseExpiresAt.$lte instanceof Date,
    );
    assert.deepEqual(
      { _id: filter._id, ownerId: filter.ownerId, contentVersion: filter.contentVersion },
      { _id: sourceId, ownerId, contentVersion: 1 },
    );
  } finally {
    model.findOneAndUpdate = original;
  }
});

test("matching Gemini metadata is not included in the stale indexed claim path", async () => {
  const model = KnowledgeSourceModel as unknown as ModelStub;
  const original = model.findOneAndUpdate;
  let captured: unknown[] | undefined;
  const query: QueryStub = {
    select: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    lean: () => query,
    exec: async () => null,
  };
  model.findOneAndUpdate = (...args: unknown[]) => {
    captured = args;
    return query;
  };

  try {
    const result = await claimKnowledgeSourceIndexing(
      ownerId,
      sourceId,
      1,
      "attempt-2",
      new Date("2030-01-01T00:10:00.000Z"),
      "gemini-embedding-2",
      1536,
    );
    const filter = captured?.[0] as { $or: Array<Record<string, unknown>> };
    assert.equal(result, null);
    const staleBranch = filter.$or[2] as {
      $and: [
        { $or: Array<Record<string, unknown>> },
        { $or: Array<Record<string, unknown>> },
      ];
    };
    assert.deepEqual(staleBranch.$and[0].$or, [
      { indexedEmbeddingModel: { $ne: "gemini-embedding-2" } },
      { indexedDimensions: { $ne: 1536 } },
    ]);
    assert.deepEqual(staleBranch.$and[1].$or[0], { indexingLeaseExpiresAt: null });
  } finally {
    model.findOneAndUpdate = original;
  }
});

test("indexed stale metadata retains active-lease protection and expired recovery", async () => {
  const model = KnowledgeSourceModel as unknown as ModelStub;
  const original = model.findOneAndUpdate;
  let candidateLease: Date | null = new Date("2030-01-01T00:05:00.000Z");
  const candidate = {
    processingStatus: "indexed",
    indexedEmbeddingModel: "text-embedding-3-small",
    indexedDimensions: 1536,
    indexingLeaseExpiresAt: candidateLease,
  };
  const query: QueryStub = {
    select: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    lean: () => query,
    exec: async () =>
      candidateLease && candidateLease > new Date("2030-01-01T00:00:00.000Z")
        ? null
        : candidate,
  };
  const captured: unknown[][] = [];
  model.findOneAndUpdate = (...args: unknown[]) => {
    captured.push(args);
    return query;
  };

  try {
    const activeResult = await claimKnowledgeSourceIndexing(
      ownerId,
      sourceId,
      1,
      "attempt-active",
      new Date("2030-01-01T00:10:00.000Z"),
      "gemini-embedding-2",
      1536,
    );
    candidateLease = new Date("2029-12-31T23:59:00.000Z");
    const expiredResult = await claimKnowledgeSourceIndexing(
      ownerId,
      sourceId,
      1,
      "attempt-expired",
      new Date("2030-01-01T00:10:00.000Z"),
      "gemini-embedding-2",
      1536,
    );
    assert.equal(activeResult, null);
    assert.equal(expiredResult, candidate);
    const indexedBranch = (captured[0]?.[0] as { $or: Array<Record<string, unknown>> }).$or[2] as {
      $and: [
        { $or: Array<Record<string, unknown>> },
        { $or: Array<Record<string, unknown>> },
      ];
    };
    const secondIndexedBranch = (captured[1]?.[0] as {
      $or: Array<Record<string, unknown>>;
    }).$or[2] as typeof indexedBranch;
    assert.deepEqual(indexedBranch.$and[0], secondIndexedBranch.$and[0]);
    assert.deepEqual(indexedBranch.$and[1].$or[0], { indexingLeaseExpiresAt: null });
    assert.deepEqual(secondIndexedBranch.$and[1].$or[0], { indexingLeaseExpiresAt: null });
    assert.ok(
      indexedBranch.$and[1].$or[1].indexingLeaseExpiresAt &&
        typeof indexedBranch.$and[1].$or[1].indexingLeaseExpiresAt === "object" &&
        "$lte" in indexedBranch.$and[1].$or[1].indexingLeaseExpiresAt &&
        indexedBranch.$and[1].$or[1].indexingLeaseExpiresAt.$lte instanceof Date,
    );
    assert.ok(
      secondIndexedBranch.$and[1].$or[1].indexingLeaseExpiresAt &&
        typeof secondIndexedBranch.$and[1].$or[1].indexingLeaseExpiresAt === "object" &&
        "$lte" in secondIndexedBranch.$and[1].$or[1].indexingLeaseExpiresAt &&
        secondIndexedBranch.$and[1].$or[1].indexingLeaseExpiresAt.$lte instanceof Date,
    );
  } finally {
    model.findOneAndUpdate = original;
  }
});
