import assert from "node:assert/strict";
import { test } from "node:test";
import { SignalModel } from "../src/models/signal.model.js";
import { reserveSignalForGeneration } from "../src/repositories/signal.repository.js";

const ownerId = "507f1f77bcf86cd799439011";
const signalId = "507f1f77bcf86cd799439012";

interface QueryStub {
  select(): QueryStub;
  lean<T>(): QueryStub;
  exec(): Promise<null>;
}

test("Signal generation reservation writes a generating token and expiry", async () => {
  const model = SignalModel as unknown as {
    findOneAndUpdate: (...args: unknown[]) => QueryStub;
  };
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

  const leaseId = "lease-under-test";
  const leaseExpiresAt = new Date("2030-01-01T00:04:00.000Z");
  try {
    await reserveSignalForGeneration(ownerId, signalId, leaseId, leaseExpiresAt);
    assert.ok(captured);
    const filter = captured[0] as Record<string, unknown>;
    const update = captured[1] as {
      $set: Record<string, unknown>;
    };
    assert.equal(filter.ownerId, ownerId);
    assert.equal(filter._id, signalId);
    assert.deepEqual(update.$set, {
      generationLeaseId: leaseId,
      generationLeaseExpiresAt: leaseExpiresAt,
      generationLeaseState: "generating",
    });
  } finally {
    model.findOneAndUpdate = original;
  }
});
