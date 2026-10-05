import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import { QuotaModel, UsageModel } from "../src/models/usage.model.js";
import { reserveUsage, transitionUsage } from "../src/repositories/usage.repository.js";

const ownerId = "507f1f77bcf86cd799439011";
const windowStart = new Date("2026-09-30T00:00:00.000Z");
const now = new Date("2026-09-30T10:00:00.000Z");
const operationKey = "generation:signal-1";

type ReservationStatus = "reserved" | "dispatched" | "completed" | "released" | "uncertain";
type MockReservation = {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  windowStart: Date;
  operationKey: string;
  operationType: string;
  status: ReservationStatus;
  expiresAt: Date;
  dispatchStartedAt: Date | null;
  completedAt: Date | null;
  inputTokens: number | null;
  outputTokens: number | null;
  embeddingTokens: number | null;
  model: string | null;
  pricingBasis: null;
  usageRecordedAt: Date | null;
};

function installModels(initial: MockReservation) {
  const originalUsageFindOne = UsageModel.findOne;
  const originalUsageFindOneAndUpdate = UsageModel.findOneAndUpdate;
  const originalUsageCreate = UsageModel.create;
  const originalQuotaUpdateOne = QuotaModel.updateOne;
  const originalQuotaFindOneAndUpdate = QuotaModel.findOneAndUpdate;
  const originalState = { reservation: { ...initial }, quotaUpdates: [] as unknown[] };
  const query = <T>(value: T) => ({
    lean() { return this; },
    exec: async () => value,
  });
  Object.defineProperty(UsageModel, "findOne", {
    configurable: true,
    value: (filter: Record<string, unknown>) => {
      let matches = filter.operationKey === undefined || filter.operationKey === originalState.reservation.operationKey;
      if (Array.isArray(filter.$or)) {
        matches = filter.$or.some((condition: unknown) => {
          if (typeof condition !== "object" || condition === null) return false;
          const operationKeyFilter = (condition as { operationKey?: unknown }).operationKey;
          return operationKeyFilter === originalState.reservation.operationKey ||
            (operationKeyFilter instanceof RegExp && operationKeyFilter.test(originalState.reservation.operationKey));
        });
      }
      const clauses = filter.$and;
      if (Array.isArray(clauses)) {
        const statusClause = clauses[0] as { $or?: Array<{ status?: unknown; expiresAt?: { $gt?: Date } }> } | undefined;
        const statusMatches = statusClause?.$or?.some((condition) => {
          if (condition.status && typeof condition.status === "object" && "$in" in condition.status) {
            return (condition.status as { $in: string[] }).$in.includes(originalState.reservation.status);
          }
          if (condition.status !== originalState.reservation.status) return false;
          return condition.expiresAt?.$gt === undefined || originalState.reservation.expiresAt > condition.expiresAt.$gt;
        }) ?? true;
        matches &&= statusMatches;
      }
      return query(matches ? { ...originalState.reservation } : null);
    },
  });
  Object.defineProperty(UsageModel, "findOneAndUpdate", {
    configurable: true,
    value: (filter: Record<string, unknown>, update: { $set: Partial<MockReservation> }) => {
      const reservation = originalState.reservation;
      const expiration = filter.expiresAt as { $lte?: Date } | undefined;
      if (
        (filter._id !== undefined && filter._id.toString() !== reservation._id.toString()) ||
        filter.status !== reservation.status ||
        (filter.windowStart instanceof Date && filter.windowStart.getTime() !== reservation.windowStart.getTime()) ||
        (expiration?.$lte && reservation.expiresAt > expiration.$lte) ||
        (filter.dispatchStartedAt === null && reservation.dispatchStartedAt !== null)
      ) {
        return query(null);
      }
      Object.assign(reservation, update.$set);
      return query({ ...reservation });
    },
  });
  Object.defineProperty(QuotaModel, "updateOne", {
    configurable: true,
    value: (...args: unknown[]) => {
      originalState.quotaUpdates.push(args);
      return { exec: async () => ({ acknowledged: true, modifiedCount: 1 }) };
    },
  });
  Object.defineProperty(QuotaModel, "findOneAndUpdate", {
    configurable: true,
    value: (filter: { scope: string }) => query({
      _id: new Types.ObjectId(),
      reserved: 1,
      completed: 0,
      ...(filter.scope === "owner" ? {} : {}),
    }),
  });
  Object.defineProperty(UsageModel, "create", {
    configurable: true,
    value: async () => {
      throw new Error("Unexpected usage creation in recovery test");
    },
  });

  return {
    state: originalState,
    restore() {
      Object.defineProperty(UsageModel, "findOne", { configurable: true, value: originalUsageFindOne });
      Object.defineProperty(UsageModel, "findOneAndUpdate", { configurable: true, value: originalUsageFindOneAndUpdate });
      Object.defineProperty(UsageModel, "create", { configurable: true, value: originalUsageCreate });
      Object.defineProperty(QuotaModel, "updateOne", { configurable: true, value: originalQuotaUpdateOne });
      Object.defineProperty(QuotaModel, "findOneAndUpdate", { configurable: true, value: originalQuotaFindOneAndUpdate });
    },
  };
}

function reservation(
  status: ReservationStatus,
  expiresAt = new Date(now.getTime() + 60_000),
  currentOperationKey = operationKey,
): MockReservation {
  return {
    _id: new Types.ObjectId(),
    ownerId: new Types.ObjectId(ownerId),
    windowStart,
    operationKey: currentOperationKey,
    operationType: "generation",
    status,
    expiresAt,
    dispatchStartedAt: status === "reserved" ? null : new Date(now.getTime() - 60_000),
    completedAt: null,
    inputTokens: null,
    outputTokens: null,
    embeddingTokens: null,
    model: null,
    pricingBasis: null,
    usageRecordedAt: null,
  };
}

async function reserve() {
  return reserveUsage(ownerId, windowStart, operationKey, "generation", 10, 100, now);
}

test("released historical reservations can be atomically admitted again", async () => {
  const models = installModels(reservation("released"));
  try {
    const result = await reserve();
    assert.equal(result?.duplicate, false);
    assert.equal(models.state.reservation.status, "reserved");
    assert.equal(models.state.reservation.dispatchStartedAt, null);
    assert.ok(models.state.reservation.expiresAt > now);
  } finally {
    models.restore();
  }
});

test("expired never-dispatched reservations are atomically renewed without double-reserving quota", async () => {
  const models = installModels(reservation("reserved", new Date(now.getTime() - 1)));
  try {
    const result = await reserve();
    assert.equal(result?.duplicate, false);
    assert.ok(models.state.reservation.expiresAt > now);
    assert.equal(models.state.reservation.status, "reserved");
    assert.equal(models.state.quotaUpdates.length, 4);
  } finally {
    models.restore();
  }
});

test("active, dispatched, and uncertain reservations remain blocking even after expiry", async () => {
  for (const current of [
    reservation("reserved"),
    reservation("dispatched", new Date(now.getTime() - 1)),
    reservation("uncertain", new Date(now.getTime() - 1)),
  ]) {
    const models = installModels(current);
    try {
      const result = await reserve();
      assert.equal(result?.duplicate, true);
      assert.equal(models.state.reservation.status, current.status);
    } finally {
      models.restore();
    }
  }
});

test("a dispatched release records consumed quota instead of refunding it", async () => {
  const models = installModels(reservation("dispatched"));
  try {
    const result = await transitionUsage(
      models.state.reservation._id.toString(),
      "dispatched",
      "released",
      { model: "gemini-3.5-flash-lite", inputTokens: 10, outputTokens: 5 },
      now,
    );
    assert.equal(result?.status, "released");
    assert.equal(models.state.reservation.status, "released");
    assert.ok(
      models.state.quotaUpdates.some(
        ([filter, update]) =>
          (filter as { scope?: string }).scope === "owner" &&
          (update as { $inc?: { reserved?: number; completed?: number } }).$inc?.reserved === -1 &&
          (update as { $inc?: { reserved?: number; completed?: number } }).$inc?.completed === 1,
      ),
    );
  } finally {
    models.restore();
  }
});

test("active and uncertain historical lease attempts block a new attempt after lease expiry", async () => {
  for (const status of ["dispatched", "uncertain"] as const) {
    const prefix = "generation:signal-1:";
    for (const previousKey of [`${prefix}old-lease`, prefix.slice(0, -1)]) {
      const models = installModels(reservation(status, new Date(now.getTime() - 60_000), previousKey));
      try {
        const result = await reserveUsage(
          ownerId,
          windowStart,
          `${prefix}new-lease`,
          "generation",
          10,
          100,
          now,
          300_000,
          prefix,
        );
        assert.equal(result?.duplicate, true);
        assert.equal(models.state.quotaUpdates.length, 0);
      } finally {
        models.restore();
      }
    }
  }
});

test("concurrent retries recover only one released reservation", async () => {
  const models = installModels(reservation("released"));
  try {
    const results = await Promise.all([reserve(), reserve()]);
    assert.equal(results.filter((result) => result?.duplicate === false).length, 1);
    assert.equal(results.filter((result) => result?.duplicate === true).length, 1);
    assert.equal(models.state.reservation.status, "reserved");
  } finally {
    models.restore();
  }
});

test("concurrent retries recover an expired reservation only once", async () => {
  const models = installModels(reservation("reserved", new Date(now.getTime() - 1)));
  try {
    const results = await Promise.all([reserve(), reserve()]);
    assert.equal(results.filter((result) => result?.duplicate === false).length, 1);
    assert.equal(results.filter((result) => result?.duplicate === true).length, 1);
    assert.ok(models.state.reservation.expiresAt > now);
  } finally {
    models.restore();
  }
});
