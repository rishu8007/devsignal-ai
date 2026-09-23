import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors/app-error.js";
import {
  admitAiOperation,
  aggregateProviderUsage,
  getUsageForUser,
  markAiDispatched,
  markAiUncertain,
  releaseAiOperation,
  type UsageRepositoryBoundary,
} from "../src/services/usage.service.js";

const owner = "507f1f77bcf86cd799439011";
const otherOwner = "507f1f77bcf86cd799439012";

function fakeRepository(options: {
  reserve?: UsageRepositoryBoundary["reserveUsage"];
  transition?: UsageRepositoryBoundary["transitionUsage"];
  summary?: UsageRepositoryBoundary["usageSummary"];
} = {}): UsageRepositoryBoundary {
  return {
    reserveUsage: options.reserve ?? (async (_owner, _window, key) => ({
      duplicate: false,
      reservation: { _id: { toString: () => key }, operationType: "generation" },
    } as never)),
    transitionUsage: options.transition ?? (async () => ({ status: "completed" } as never)),
    usageSummary: options.summary ?? (async () => [null, []] as never),
  };
}

test("duplicate logical admission returns the existing reservation", async () => {
  let calls = 0;
  const repository = fakeRepository({
    reserve: async () => {
      calls += 1;
      return { duplicate: true, reservation: { _id: { toString: () => "existing" } } } as never;
    },
  });
  const result = await admitAiOperation(owner, "generation:one", "generation", new Date("2026-09-22T00:00:00Z"), repository);
  assert.equal(result.duplicate, true);
  assert.equal(result.id, "existing");
  assert.equal(calls, 1);
});

test("owner identity is part of admission and invalid owners fail before storage", async () => {
  let called = false;
  const repository = fakeRepository({ reserve: async () => { called = true; return null; } });
  await assert.rejects(
    admitAiOperation("not-an-owner", "generation:one", "generation", new Date(), repository),
    (error: unknown) => error instanceof AppError && error.code === "AUTHENTICATION_REQUIRED",
  );
  assert.equal(called, false);
  assert.notEqual(owner, otherOwner);
});

test("UTC rollover changes quota window but not logical operation identity", async () => {
  const windows: Date[] = [];
  const repository = fakeRepository({
    reserve: async (_owner, window) => {
      windows.push(window);
      return { duplicate: windows.length > 1, reservation: { _id: { toString: () => "same-operation" } } } as never;
    },
  });
  const first = await admitAiOperation(owner, "research:req-1", "research", new Date("2026-09-22T23:59:59Z"), repository);
  const second = await admitAiOperation(owner, "research:req-1", "research", new Date("2026-09-23T00:00:01Z"), repository);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.notEqual(windows[0]?.getTime(), windows[1]?.getTime());
});

test("expired reservation cannot be dispatched by a stale caller", async () => {
  const transitions: string[] = [];
  const repository = fakeRepository({
    transition: async (_id, from, to) => {
      transitions.push(`${from}->${to}`);
      return to === "dispatched" ? null : ({ status: "released" } as never);
    },
  });
  await assert.rejects(
    markAiDispatched("expired", new Date("2026-09-22T00:00:00Z"), repository),
    (error: unknown) => error instanceof AppError && error.code === "AI_OPERATION_EXPIRED",
  );
  assert.deepEqual(transitions, ["reserved->dispatched", "reserved->released"]);
});

test("known pre-dispatch failures release while uncertain work is retained", async () => {
  const transitions: string[] = [];
  const repository = fakeRepository({
    transition: async (_id, from, to) => {
      transitions.push(`${from}->${to}`);
      return { status: to } as never;
    },
  });
  await releaseAiOperation("known-failure", repository);
  await markAiUncertain("timed-out", repository);
  assert.deepEqual(transitions, ["reserved->released", "dispatched->uncertain"]);
});

test("provider usage aggregates multiple calls without inventing missing counters", () => {
  assert.deepEqual(aggregateProviderUsage([
    { model: "a", inputTokens: 10, outputTokens: 5, embeddingTokens: null },
    { model: "b", inputTokens: null, outputTokens: 7, embeddingTokens: 12 },
  ]), { model: "a,b", inputTokens: 10, outputTokens: 12, embeddingTokens: 12 });
});

test("persisted result reuse is represented by no admission call", async () => {
  let called = false;
  const repository = fakeRepository({ reserve: async () => { called = true; return null; } });
  assert.equal(called, false);
  assert.equal((await getUsageForUser(owner, new Date("2026-09-22T12:00:00Z"), repository)).used, 0);
});

test("usage summaries keep reserved and uncertain work distinct", async () => {
  const result = await getUsageForUser(owner, new Date("2026-09-22T12:00:00Z"), fakeRepository({
    summary: async () => [null, [
      { operationType: "generation", status: "completed", inputTokens: 10, outputTokens: null },
      { operationType: "research", status: "reserved" },
      { operationType: "review", status: "uncertain", inputTokens: null },
    ]] as never,
  }));
  assert.equal(result.used, 2);
  assert.equal(result.reserved, 1);
  assert.equal(result.knownUsageRecords, 1);
});

test("different owners contend atomically for the final application slot", async () => {
  const reservations = new Map<string, { id: string; status: "reserved" | "dispatched" | "released" }>();
  let applicationSlots = 1;
  let providerCalls = 0;
  const repository = fakeRepository({
    reserve: async (ownerId, _window, operationKey) => {
      const existing = reservations.get(operationKey);
      if (existing) return { duplicate: true, reservation: { _id: { toString: () => existing.id } } } as never;
      if (applicationSlots === 0) return null;
      applicationSlots -= 1;
      const reservation = { id: `${ownerId}:${operationKey}`, status: "reserved" as const };
      reservations.set(operationKey, reservation);
      return { duplicate: false, reservation: { _id: { toString: () => reservation.id } } } as never;
    },
    transition: async (id, from, to) => {
      const reservation = [...reservations.values()].find((item) => item.id === id);
      if (!reservation || reservation.status !== from) return null;
      reservation.status = to;
      if (to === "released") applicationSlots += 1;
      return { status: to } as never;
    },
  });
  const [first, second] = await Promise.all([
    admitAiOperation(owner, "generation:first", "generation", new Date(), repository),
    admitAiOperation(otherOwner, "generation:second", "generation", new Date(), repository),
  ].map(async (admissionPromise) => {
    try {
      const admission = await admissionPromise;
      await markAiDispatched(admission.id, new Date(), repository);
      providerCalls += 1;
      return "dispatched";
    } catch (error) {
      return error instanceof AppError ? error.code : "unexpected";
    }
  }));
  assert.deepEqual([first, second].sort(), ["AI_QUOTA_EXCEEDED", "dispatched"]);
  assert.equal(providerCalls, 1);
  assert.equal(applicationSlots, 0);
  const repeatAuthorized = await admitAiOperation(owner, "generation:first", "generation", new Date(), repository);
  assert.equal(repeatAuthorized.duplicate, true);
  await assert.rejects(
    admitAiOperation(otherOwner, "generation:second", "generation", new Date(), repository),
    (error: unknown) => error instanceof AppError && error.code === "AI_QUOTA_EXCEEDED",
  );
  assert.equal(providerCalls, 1);
});

test("admission storage failure fails closed before provider work", async () => {
  let providerCalls = 0;
  const repository = fakeRepository({
    reserve: async () => { throw new Error("quota store unavailable"); },
  });
  await assert.rejects(
    admitAiOperation(owner, "generation:storage-failure", "generation", new Date(), repository),
    (error: unknown) => error instanceof AppError && error.code === "AI_QUOTA_UNAVAILABLE",
  );
  assert.equal(providerCalls, 0);
});

test("partial reservation failure remains conservative and cannot be released twice", async () => {
  let releaseCalls = 0;
  const repository = fakeRepository({
    reserve: async () => {
      throw new Error("failure before reservation document");
    },
    transition: async (_id, from, to) => {
      if (from === "reserved" && to === "released") {
        releaseCalls += 1;
      }
      return null;
    },
  });
  await assert.rejects(admitAiOperation(owner, "generation:partial", "generation", new Date(), repository));
  assert.equal(await releaseAiOperation("partial", repository), null);
  assert.equal(await releaseAiOperation("partial", repository), null);
  assert.equal(releaseCalls, 2);
});

test("dispatch-state persistence failure prevents provider work and stale dispatch", async () => {
  let providerCalls = 0;
  let released = false;
  const repository = fakeRepository({
    transition: async (_id, from, to) => {
      if (from === "reserved" && to === "dispatched") return null;
      if (from === "reserved" && to === "released") {
        released = true;
        return { status: "released" } as never;
      }
      return null;
    },
  });
  await assert.rejects(
    markAiDispatched("dispatch-failure", new Date(), repository),
    (error: unknown) => error instanceof AppError && error.code === "AI_OPERATION_EXPIRED",
  );
  if (!released) providerCalls += 1;
  assert.equal(providerCalls, 0);
  assert.equal(released, true);
  await assert.rejects(
    markAiDispatched("dispatch-failure", new Date(), repository),
    (error: unknown) => error instanceof AppError && error.code === "AI_OPERATION_EXPIRED",
  );
  assert.equal(providerCalls, 0);
});

test("completion persistence failure does not refund or replay provider work", async () => {
  let providerCalls = 0;
  let admissions = 0;
  const repository = fakeRepository({
    reserve: async (_owner, _window, key) => {
      admissions += 1;
      return {
        duplicate: admissions > 1,
        reservation: { _id: { toString: () => "completed-once" }, operationKey: key },
      } as never;
    },
    transition: async (_id, from, to) => {
      if (from === "reserved" && to === "dispatched") return { status: "dispatched" } as never;
      if (from === "dispatched" && to === "completed") throw new Error("completion store unavailable");
      return null;
    },
  });
  const first = await admitAiOperation(owner, "generation:completion-failure", "generation", new Date(), repository);
  await markAiDispatched(first.id, new Date(), repository);
  providerCalls += 1;
  await assert.rejects(() => repository.transitionUsage(first.id, "dispatched", "completed"));
  const second = await admitAiOperation(owner, "generation:completion-failure", "generation", new Date(), repository);
  assert.equal(second.duplicate, true);
  assert.equal(providerCalls, 1);
});
