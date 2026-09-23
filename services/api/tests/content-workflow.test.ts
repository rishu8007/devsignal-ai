import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { AppError } from "../src/errors/app-error.js";
import { createContentWorkflowReviewForUser, findCurrentWorkflowReview, mapWorkflowGenerationCitations, workflowReviewRequestId, type WorkflowReviewBoundary } from "../src/services/content-workflow.service.js";

const evidence = [{
  evidenceId: "e1",
  sourceId: "507f1f77bcf86cd799439011",
  title: "Profile",
  contentVersion: 3,
  chunkId: "507f1f77bcf86cd799439011_v3_c0",
  chunkIndex: 0,
  text: "Built a reliable deployment pipeline.",
  startOffset: 0,
  endOffset: 36,
  score: 0.9,
}];

function variations(citations: string[]) {
  return (["technical_depth", "learning_story", "professional_impact"] as const).map((angle) => ({
    angle,
    content: "A sufficiently long draft based on the supplied evidence. ".repeat(3),
    citations,
  }));
}

test("workflow citation mapping preserves server-owned provenance", () => {
  const result = mapWorkflowGenerationCitations(evidence, { model: "test", variations: variations([evidence[0].chunkId]) }, new Map());
  assert.equal(result.variations[0].citations[0].sourceId, evidence[0].sourceId);
  assert.equal(result.variations[0].citations[0].contentVersion, 3);
  assert.equal(result.variations[0].citations[0].chunkId, evidence[0].chunkId);
  assert.equal(result.variations[0].citations[0].startOffset, 0);
});

test("workflow citation mapping rejects fabricated evidence references", () => {
  assert.throws(
    () => mapWorkflowGenerationCitations(evidence, { model: "test", variations: variations(["forged"]) }, new Map()),
    /invalid response/i,
  );
});

test("workflow review binding is variation- and hash-specific", () => {
  const bindings = [
    { variationId: "a", reviewId: "review-a", draftContentHash: "hash-a", stale: false, status: "succeeded" },
    { variationId: "b", reviewId: "review-b", draftContentHash: "hash-b", stale: false, status: "succeeded" },
  ];
  assert.equal(findCurrentWorkflowReview(bindings, "a", "hash-a")?.reviewId, "review-a");
  assert.equal(findCurrentWorkflowReview(bindings, "b", "hash-a"), undefined);
  assert.equal(findCurrentWorkflowReview(bindings, "a", "changed"), undefined);
});

test("workflow review identity changes with draft and evidence inputs", () => {
  const base = {
    ownerId: "owner",
    workflowId: "workflow",
    generationId: "generation",
    variationId: "variation",
    draftContentHash: "draft-a",
    researchBriefId: "brief",
    sourceVersions: [{ sourceId: "source", contentVersion: 1 }],
  };
  const first = workflowReviewRequestId(base.ownerId, base.workflowId, base.generationId, base.variationId, base.draftContentHash, base.researchBriefId, base.sourceVersions, [{ evidenceId: "e1", contentVersion: 1 }]);
  const changedDraft = workflowReviewRequestId(base.ownerId, base.workflowId, base.generationId, base.variationId, "draft-b", base.researchBriefId, base.sourceVersions, [{ evidenceId: "e1", contentVersion: 1 }]);
  const changedEvidence = workflowReviewRequestId(base.ownerId, base.workflowId, base.generationId, base.variationId, base.draftContentHash, base.researchBriefId, base.sourceVersions, [{ evidenceId: "e2", contentVersion: 2 }]);
  assert.notEqual(first, changedDraft);
  assert.notEqual(first, changedEvidence);
});

test("workflow review does not attach a late result after cancellation", async () => {
  const ownerId = new Types.ObjectId().toString();
  const signalId = new Types.ObjectId().toString();
  const workflowId = new Types.ObjectId().toString();
  const generationId = new Types.ObjectId();
  const researchBriefId = new Types.ObjectId();
  const variationId = new Types.ObjectId();
  const sourceId = new Types.ObjectId().toString();
  const run = {
    _id: new Types.ObjectId(workflowId),
    signalId: new Types.ObjectId(signalId),
    status: "awaiting_approval",
    signalRevision: 1,
    generationId,
    researchBriefId,
    sourceVersions: [{ sourceId, contentVersion: 1 }],
    reviewBindings: [],
  };
  let findCount = 0;
  let attached = false;
  const boundary: WorkflowReviewBoundary = {
    findWorkflow: async () => {
      findCount += 1;
      return (findCount === 1 ? run : { ...run, status: "cancelled" }) as never;
    },
    findGeneration: async () => ({
      _id: generationId,
      variations: [{ _id: variationId, content: "A draft variation with enough content for review." }],
    }) as never,
    findSources: async () => [{
      _id: new Types.ObjectId(sourceId),
      processingStatus: "indexed",
      contentVersion: 1,
      indexedContentVersion: 1,
      indexedChunkerVersion: "chunker",
      indexedEmbeddingModel: "embedding",
      indexedDimensions: 3,
    }] as never,
    findSignal: async () => ({ _id: new Types.ObjectId(signalId), revision: 1 }) as never,
    findLegacyReview: async () => null,
    createReview: async () => ({
      id: "review-id",
      variationId: variationId.toString(),
      draftContentHash: "hash",
      stale: false,
      status: "succeeded",
      summary: "summary",
      findings: [],
      proposedDraft: null,
      model: "test",
    }) as never,
    addReview: async () => {
      attached = true;
      return run as never;
    },
  };
  await assert.rejects(
    createContentWorkflowReviewForUser(ownerId, signalId, workflowId, { requestId: "ignored", variationId: variationId.toString() }, boundary),
    (error: unknown) => error instanceof AppError && error.code === "WORKFLOW_CANCELLED",
  );
  assert.equal(attached, false);
});
