import assert from "node:assert/strict";
import { test } from "node:test";
import { KnowledgeSourceModel } from "../src/models/knowledge-source.model.js";
import {
  countKnowledgeSourcesByOwner,
  findKnowledgeSourcesByOwner,
  updateKnowledgeSourceIfVersionAndLeaseAvailable,
} from "../src/repositories/knowledge-source.repository.js";

const ownerId = "507f1f77bcf86cd799439011";
const sourceId = "507f1f77bcf86cd799439012";

interface QueryStub {
  select(): QueryStub;
  sort(): QueryStub;
  skip(): QueryStub;
  limit(): QueryStub;
  lean<T>(): QueryStub;
  exec(): Promise<null | unknown[]>;
}

interface ModelStub {
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
