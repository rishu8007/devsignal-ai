import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { listCalendarForUser } from "../src/services/calendar.service.js";
import { calendarQuerySchema } from "../src/validation/calendar.validation.js";
import { GenerationModel } from "../src/models/generation.model.js";
import { listCalendarByOwner } from "../src/repositories/generation.repository.js";

const ownerId = "507f1f77bcf86cd799439011";
const signalId = "507f1f77bcf86cd799439013";
const from = new Date("2030-01-01T00:00:00.000Z");
const to = new Date("2030-01-02T00:00:00.000Z");

test("calendar query requires strict timezone-aware bounded ranges", () => {
  assert.equal(
    calendarQuerySchema.safeParse({
      from: "2030-01-01T00:00:00Z",
      to: "2030-01-02T00:00:00+00:00",
      page: "1",
      limit: "50",
    }).success,
    true,
  );
  assert.equal(
    calendarQuerySchema.safeParse({
      from: "2030-01-01T00:00:00",
      to: "2030-01-02T00:00:00Z",
    }).success,
    false,
  );
  assert.equal(
    calendarQuerySchema.safeParse({
      from: "2030-01-01T00:00:00Z",
      to: "2030-04-10T00:00:00Z",
    }).success,
    false,
  );
});

test("calendar service preserves database pagination and rejects invalid owners", async () => {
  const calls: unknown[] = [];
  const repository = {
    listCalendarByOwner: async (...args: unknown[]) => {
      calls.push(args);
      return { items: [], total: 0 };
    },
  };

  const result = await listCalendarForUser(ownerId, from, to, 2, 20, repository);
  assert.deepEqual(result.pagination, { page: 2, limit: 20, total: 0, totalPages: 0 });
  assert.deepEqual(calls, [[ownerId, from, to, 2, 20]]);
  await assert.rejects(
    listCalendarForUser("not-an-object-id", from, to, 1, 20, repository),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "AUTHENTICATION_REQUIRED",
  );
  assert.equal(Types.ObjectId.isValid(ownerId), true);
});

test("calendar aggregation applies [from,to), deterministic ordering, pagination, and public projection", async () => {
  const originalAggregate = GenerationModel.aggregate;
  let pipeline: unknown[] | undefined;
  const scheduled = new Date("2030-01-01T12:00:00.000Z");
  GenerationModel.aggregate = ((receivedPipeline: unknown[]) => {
    pipeline = receivedPipeline;
    return {
      exec: async () => [{
        items: [{
          _id: new Types.ObjectId("507f1f77bcf86cd799439015"),
          generationId: new Types.ObjectId("507f1f77bcf86cd799439014"),
          signalId: new Types.ObjectId(signalId),
          topic: "Calendar topic",
          angle: "technical_depth",
          content: "saved content",
          status: "approved",
          scheduledFor: scheduled,
        }],
        total: [{ count: 3 }],
      }],
    };
  }) as typeof GenerationModel.aggregate;

  try {
    const result = await listCalendarByOwner(ownerId, from, to, 2, 1);
    assert.equal(result.total, 3);
    assert.equal(result.items[0].scheduledFor, scheduled);
    assert.deepEqual(Object.keys(result.items[0]).sort(), [
      "angle",
      "content",
      "generationId",
      "id",
      "scheduledFor",
      "signalId",
      "status",
      "topic",
    ]);
  } finally {
    GenerationModel.aggregate = originalAggregate;
  }

  assert.ok(pipeline);
  const ownerMatch = pipeline[0] as { $match: { ownerId: Types.ObjectId } };
  assert.equal(ownerMatch.$match.ownerId.toString(), ownerId);
  assert.deepEqual(pipeline[1], { $unwind: "$variations" });
  const filtered = pipeline[2] as { $match: Record<string, unknown> };
  assert.deepEqual(filtered.$match["variations.scheduledFor"], { $gte: from, $lt: to });
  const facet = pipeline[3] as {
    $facet: {
      items: Array<Record<string, unknown>>;
      total: Array<Record<string, unknown>>;
    };
  };
  assert.deepEqual(facet.$facet.items[0], {
    $sort: {
      "variations.scheduledFor": 1,
      _id: 1,
      "variations._id": 1,
    },
  });
  assert.deepEqual(facet.$facet.items.slice(1, 3), [{ $skip: 1 }, { $limit: 1 }]);
  assert.deepEqual(facet.$facet.total, [{ $count: "count" }]);
  const projection = facet.$facet.items[3] as { $project: Record<string, unknown> };
  assert.equal("ownerId" in projection.$project, false);
  assert.equal("source" in projection.$project, false);
});
