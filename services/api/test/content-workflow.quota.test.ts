import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors/app-error.js";
import { advanceWorkflowProviderStep, mapWorkflowGenerationCitations } from "../src/services/content-workflow.service.js";
import type { UsageRepositoryBoundary } from "../src/services/usage.service.js";
import { ResearchBriefModel } from "../src/models/research-brief.model.js";
import { DraftReviewModel } from "../src/models/draft-review.model.js";
import { Types } from "mongoose";

const owner = "507f1f77bcf86cd799439011";

test("in-progress research and review records satisfy required persistence fields", () => {
  const signalId = new Types.ObjectId();
  const generationId = new Types.ObjectId();
  const variationId = new Types.ObjectId();
  const brief = new ResearchBriefModel({
    ownerId: owner,
    requestId: "research-request",
    inputFingerprint: "fingerprint",
    signalId,
    signalRevision: 1,
    sourceVersions: [],
    evidence: [],
    brief: { topicSummary: "Research in progress.", talkingPoints: [], claimAssessments: [], missingInformation: [], questions: [], limitations: [] },
    status: "running",
    model: "pending",
  });
  const review = new DraftReviewModel({
    ownerId: owner,
    requestId: "review-request",
    inputFingerprint: "fingerprint",
    signalId,
    generationId,
    variationId,
    researchBriefId: new Types.ObjectId(),
    draftContentHash: "hash",
    draftContent: "draft",
    briefSnapshot: [],
    findings: [],
    summary: "Review in progress.",
    status: "running",
    model: "pending",
  });
  assert.equal(brief.validateSync(), undefined);
  assert.equal(review.validateSync(), undefined);
  brief.set({ brief: { topicSummary: "Completed.", talkingPoints: [], claimAssessments: [], missingInformation: [], questions: [], limitations: [] }, status: "succeeded", model: "research-model" });
  review.set({ summary: "Completed.", status: "succeeded", model: "review-model" });
  assert.equal(brief.validateSync(), undefined);
  assert.equal(review.validateSync(), undefined);
});

test("workflow generation citations resolve provider chunk IDs", () => {
  const result = mapWorkflowGenerationCitations(
    [{
      evidenceId: "e1",
      sourceId: "507f1f77bcf86cd799439012",
      title: "Source",
      contentVersion: 1,
      chunkId: "chunk-1",
      chunkIndex: 0,
      text: "Evidence",
      startOffset: 0,
      endOffset: 8,
      score: 0.9,
    }],
    {
      model: "test-model",
      variations: [
        { angle: "technical_depth", content: "t".repeat(100), citations: ["chunk-1"] },
        { angle: "learning_story", content: "l".repeat(100), citations: ["chunk-1"] },
        { angle: "professional_impact", content: "p".repeat(100), citations: ["chunk-1"] },
      ],
    },
    new Map([["507f1f77bcf86cd799439012", "Source"]]),
  );
  assert.equal(result.variations[0]?.citations[0]?.chunkId, "chunk-1");
});

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
