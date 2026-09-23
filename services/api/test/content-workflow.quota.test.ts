import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors/app-error.js";
import { advanceWorkflowProviderStep } from "../src/services/content-workflow.service.js";
import type { UsageRepositoryBoundary } from "../src/services/usage.service.js";

const owner = "507f1f77bcf86cd799439011";

test("workflow generation and review steps admit once and do not replay uncertain work", async () => {
  const reservations = new Map<string, { id: string; status: string }>();
  const transitions: string[] = [];
  let providerCalls = 0;
  const repository: UsageRepositoryBoundary = {
    reserveUsage: async (_owner, _window, operationKey, operationType) => {
      const existing = reservations.get(operationKey);
      if (existing) return { duplicate: true, reservation: { _id: { toString: () => existing.id } } } as never;
      const reservation = { id: operationKey, status: "reserved" };
      reservations.set(operationKey, reservation);
      return { duplicate: false, reservation: { _id: { toString: () => reservation.id }, operationType } } as never;
    },
    transitionUsage: async (id, from, to) => {
      const reservation = [...reservations.values()].find((item) => item.id === id);
      if (!reservation || reservation.status !== from) return null;
      reservation.status = to;
      transitions.push(`${id}:${from}->${to}`);
      return { status: to } as never;
    },
    usageSummary: async () => [null, []] as never,
  };
  const client = {
    advance: async () => {
      providerCalls += 1;
      if (providerCalls === 2) throw new AppError(504, "AI_SERVICE_TIMEOUT", "timed out");
      return {
        status: "paused",
        phase: "write_complete",
        state: { generation: { model: "test-model", usage: { model: "test-model", inputTokens: 2, outputTokens: 3, embeddingTokens: null } } },
        interrupt: { kind: "workflow_step" },
      };
    },
  };

  const result = await advanceWorkflowProviderStep(
    owner,
    "workflow-1",
    "generation",
    { threadId: "thread-1" },
    client,
    repository,
  );
  assert.equal(result.phase, "write_complete");
  assert.equal(providerCalls, 1);
  assert.deepEqual(transitions, [
    "workflow:workflow-1:generation:reserved->dispatched",
    "workflow:workflow-1:generation:dispatched->completed",
  ]);

  await assert.rejects(
    advanceWorkflowProviderStep(owner, "workflow-1", "draft_review", { threadId: "thread-1", resume: true }, client, repository),
    (error: unknown) => error instanceof AppError && error.code === "AI_SERVICE_TIMEOUT",
  );
  await assert.rejects(
    advanceWorkflowProviderStep(owner, "workflow-1", "draft_review", { threadId: "thread-1", resume: true }, client, repository),
    (error: unknown) => error instanceof AppError && error.code === "AI_OPERATION_IN_PROGRESS",
  );
  assert.equal(providerCalls, 2);
});
