import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../src/errors/app-error.js";
import { createDraftReviewForUser, applyDraftReviewForUser, type DraftReviewRepository } from "../src/services/draft-review.service.js";

const ownerId = new Types.ObjectId().toString();
const signalId = new Types.ObjectId().toString();
const variationId = new Types.ObjectId();
const generationId = new Types.ObjectId();
const briefId = new Types.ObjectId();
const content = "This draft contains a sufficiently long technical passage that can be reviewed against the selected evidence without making unsupported claims.";
const signal = { _id: new Types.ObjectId(signalId), revision: 1 };
const generation = { _id: generationId, variations: [{ _id: variationId, content, status: "approved", scheduledFor: new Date(), citations: [] }] };
const brief = { _id: briefId, signalId: new Types.ObjectId(signalId), status: "succeeded", stale: false, updatedAt: new Date(), sourceVersions: [{ sourceId: new Types.ObjectId().toString(), contentVersion: 1 }], evidence: [{ evidenceId: "e1", text: "Selected evidence", quote: "Selected evidence" }] };
function repository(overrides: Partial<DraftReviewRepository> = {}): DraftReviewRepository {
  const run = { _id: new Types.ObjectId(), signalId: new Types.ObjectId(signalId), generationId, variationId, researchBriefId: briefId, draftContent: content, draftContentHash: "hash", status: "succeeded", stale: false, findings: [], summary: "Summary", proposedDraft: null, model: "test", createdAt: new Date(), updatedAt: new Date(), inputFingerprint: "fp" };
  return {
    findSignal: async () => signal as never,
    findGeneration: async () => generation as never,
    findBrief: async () => brief as never,
    findSources: async () => [{ _id: new Types.ObjectId(brief.sourceVersions[0].sourceId), contentVersion: 1, processingStatus: "indexed", indexedContentVersion: 1 }] as never,
    create: async (input) => ({ ...run, ...input }) as never,
    findReview: async () => run as never,
    findRequest: async () => null,
    list: async () => [run] as never,
    update: async (_id, input) => ({ ...run, ...input }) as never,
    apply: async () => ({ ...generation, variations: [{ ...generation.variations[0], content: "Applied " + content, status: "draft", scheduledFor: null, citations: [] }] }) as never,
    ...overrides,
  };
}
const reviewInput = { requestId: "review-12345678", researchBriefId: briefId.toString() };
const client = { review: async () => ({ model: "test", summary: "Review", findings: [{ category: "clarity", severity: "low", passage: content.slice(0, 20), explanation: "Clarify this passage.", evidenceIds: ["e1"], suggestion: "Add detail." }], proposedDraft: content }) };

test("rejects missing owner resources and fabricated review references", async () => {
  await assert.rejects(createDraftReviewForUser(ownerId, signalId, variationId.toString(), reviewInput, client, repository({ findSignal: async () => null })), /Signal not found/);
  const badClient = { review: async () => ({ ...await client.review(), findings: [{ ...((await client.review()).findings[0]), evidenceIds: ["forged"] }] }) };
  await assert.rejects(createDraftReviewForUser(ownerId, signalId, variationId.toString(), { ...reviewInput, requestId: "review-22345678" }, badClient, repository()), (error: unknown) => error instanceof AppError && error.code === "AI_INVALID_RESPONSE");
});

test("duplicate request does not repeat provider work and creation leaves draft unchanged", async () => {
  let calls = 0;
  let saved: unknown = null;
  const counting = { review: async () => { calls += 1; return client.review(); } };
  const resultRepository = repository({
    create: async (input) => {
      const created = await repository().create(input);
      saved = created;
      return created;
    },
    findRequest: async () => saved as never,
  });
  const result = await createDraftReviewForUser(ownerId, signalId, variationId.toString(), reviewInput, counting, resultRepository);
  await createDraftReviewForUser(ownerId, signalId, variationId.toString(), reviewInput, counting, resultRepository);
  assert.equal(calls, 1);
  assert.equal(generation.variations[0].status, "approved");
  assert.notEqual(result.proposedDraft, null);
});

test("uncertain identical review does not replay provider work", async () => {
  let calls = 0;
  const fingerprint = createHash("sha256").update(JSON.stringify({ variationId: variationId.toString(), briefId: briefId.toString(), draft: content, briefUpdatedAt: brief.updatedAt })).digest("hex");
  const uncertain = { ...(await repository().findReview(ownerId, "review-id")), status: "uncertain", inputFingerprint: fingerprint };
  const counting = { review: async () => { calls += 1; return client.review(); } };
  await createDraftReviewForUser(
    ownerId,
    signalId,
    variationId.toString(),
    reviewInput,
    counting,
    repository({ findRequest: async () => uncertain as never }),
  );
  assert.equal(calls, 0);
});

test("apply uses expected content and returns a conflict after the draft changes", async () => {
  const review = { ...(await createDraftReviewForUser(ownerId, signalId, variationId.toString(), reviewInput, client, repository())), draftContentHash: "hash" };
  const applied = await applyDraftReviewForUser(ownerId, signalId, variationId.toString(), review.id, { expectedContentHash: "hash", content: content + " Added." }, repository({ findReview: async () => ({ ...review, _id: new Types.ObjectId(review.id), signalId: new Types.ObjectId(signalId), variationId }) as never }));
  assert.equal(applied.variations[0].status, "draft");
  await assert.rejects(applyDraftReviewForUser(ownerId, signalId, variationId.toString(), review.id, { expectedContentHash: "wrong", content: content + " Added." }, repository({ findReview: async () => ({ ...review, _id: new Types.ObjectId(review.id), signalId: new Types.ObjectId(signalId), variationId }) as never })), /current draft/);
});
