import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import { GenerationModel } from "../src/models/generation.model.js";
import { listDraftsByOwner } from "../src/repositories/generation.repository.js";

test("draft aggregation uses a non-_id facet count output field", async () => {
  const originalAggregate = GenerationModel.aggregate;
  let pipeline: unknown[] | undefined;
  GenerationModel.aggregate = ((receivedPipeline: unknown[]) => {
    pipeline = receivedPipeline;
    return {
      exec: async () => [{
        drafts: [],
        total: [{ count: 0 }],
        summary: [],
        scheduled: [{ count: 2 }],
      }],
    };
  }) as typeof GenerationModel.aggregate;

  try {
    await listDraftsByOwner("507f1f77bcf86cd799439011", 1, 2);
  } finally {
    GenerationModel.aggregate = originalAggregate;
  }

  assert.ok(pipeline);
  const facet = pipeline[1] as {
    $facet: {
      total: Array<Record<string, unknown>>;
      scheduled: Array<Record<string, unknown>>;
    };
  };
  assert.deepEqual(facet.$facet.total.at(-1), { $count: "count" });
  const ownerMatch = pipeline[0] as { $match: { ownerId: Types.ObjectId } };
  assert.equal(ownerMatch.$match.ownerId.toString(), "507f1f77bcf86cd799439011");
  const scheduled = facet.$facet.scheduled;
  assert.deepEqual(scheduled, [
    { $unwind: "$variations" },
    {
      $match: {
        "variations.status": "approved",
        "variations.scheduledFor": { $type: "date" },
      },
    },
    { $count: "count" },
  ]);
});
