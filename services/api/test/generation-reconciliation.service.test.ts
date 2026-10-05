import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { reconcileUncertainGenerationForAdmin } from "../src/services/generation-reconciliation.service.js";

const operationId = new Types.ObjectId().toString();
const signalId = new Types.ObjectId().toString();
const ownerId = new Types.ObjectId();
const now = new Date("2026-10-01T10:00:00.000Z");

function repository(overrides: Partial<{
  operation: Record<string, unknown> | null;
  activeLease: boolean;
  reconciled: Record<string, unknown> | null;
}> = {}) {
  const operation = overrides.operation ?? {
    _id: new Types.ObjectId(operationId),
    ownerId,
    operationType: "generation",
    operationKey: `generation:${signalId}:lease-id`,
    status: "uncertain",
    expiresAt: new Date("2026-10-01T09:00:00.000Z"),
  };
  return {
    findUsageById: async () => operation,
    hasAnyActiveSignalGenerationLease: async () => overrides.activeLease ?? false,
    reconcileUncertainGeneration: async () => overrides.reconciled ?? {
      _id: new Types.ObjectId(operationId),
      operationType: "generation",
      status: "reconciled",
      reconciledAt: now,
      reconciledBy: "test",
      reconciliationReason: "provider outcome verified",
    },
  };
}

test("reconciles one expired uncertain generation and preserves consumed usage", async () => {
  const result = await reconcileUncertainGenerationForAdmin(
    operationId,
    "provider outcome verified",
    "test",
    now,
    repository(),
  );
  assert.equal(result.status, "reconciled");
  assert.equal(result.reconciliationReason, "provider outcome verified");
});

test("active Signal lease blocks reconciliation", async () => {
  await assert.rejects(
    reconcileUncertainGenerationForAdmin(operationId, "reason", "test", now, repository({ activeLease: true })),
    (error: unknown) => error instanceof Error && error.message === "The Signal generation lease is still active",
  );
});

test("matching non-uncertain or unexpired operations cannot be reconciled", async () => {
  await assert.rejects(
    reconcileUncertainGenerationForAdmin(
      operationId,
      "reason",
      "test",
      now,
      repository({ operation: {
        _id: new Types.ObjectId(operationId),
        ownerId,
        operationType: "generation",
        operationKey: `generation:${signalId}:lease-id`,
        status: "completed",
        expiresAt: new Date("2026-10-01T09:00:00.000Z"),
      } }),
    ),
    (error: unknown) => error instanceof Error && error.message.includes("not an expired uncertain"),
  );
});
