import assert from "node:assert/strict";
import { test } from "node:test";
import { KnowledgeSourceModel } from "../src/models/knowledge-source.model.js";
import { updateKnowledgeSourceIfVersionAndLeaseAvailable } from "../src/repositories/knowledge-source.repository.js";

const ownerId = "507f1f77bcf86cd799439011";
const sourceId = "507f1f77bcf86cd799439012";

interface QueryStub {
  select(): QueryStub;
  lean<T>(): QueryStub;
  exec(): Promise<null>;
}

interface ModelStub {
  findOneAndUpdate(...args: unknown[]): QueryStub;
}

test("source edit repository enables Mongoose update pipelines and literalizes user text", async () => {
  const model = KnowledgeSourceModel as unknown as ModelStub;
  const original = model.findOneAndUpdate;
  let captured: unknown[] | undefined;
  const query: QueryStub = {
    select: () => query,
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
