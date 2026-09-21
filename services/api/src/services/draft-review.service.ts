import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import { aiDraftReviewClient, type DraftReviewClient } from "../clients/draft-review.client.js";
import { findGenerationByOwnerAndSignal, updateGenerationVariationIfContentMatches } from "../repositories/generation.repository.js";
import { findResearchBriefByIdAndOwner } from "../repositories/research-brief.repository.js";
import { findKnowledgeSourcesByIdsAndOwner } from "../repositories/knowledge-source.repository.js";
import { findSignalByIdAndOwner } from "../repositories/signal.repository.js";
import { createDraftReview, findDraftReviewByIdAndOwner, findDraftReviewByRequestId, listDraftReviews, updateDraftReview } from "../repositories/draft-review.repository.js";
import type { ApplyReviewInput, CreateReviewInput } from "../validation/draft-review.validation.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Generation = Awaited<ReturnType<typeof findGenerationByOwnerAndSignal>>;
export interface DraftReviewRepository {
  findSignal: typeof findSignalByIdAndOwner;
  findGeneration: typeof findGenerationByOwnerAndSignal;
  findBrief: typeof findResearchBriefByIdAndOwner;
  findSources: typeof findKnowledgeSourcesByIdsAndOwner;
  create: typeof createDraftReview;
  findReview: typeof findDraftReviewByIdAndOwner;
  findRequest: typeof findDraftReviewByRequestId;
  list: typeof listDraftReviews;
  update: typeof updateDraftReview;
  apply: typeof updateGenerationVariationIfContentMatches;
}
const defaultRepository: DraftReviewRepository = { findSignal: findSignalByIdAndOwner, findGeneration: findGenerationByOwnerAndSignal, findBrief: findResearchBriefByIdAndOwner, findSources: findKnowledgeSourcesByIdsAndOwner, create: createDraftReview, findReview: findDraftReviewByIdAndOwner, findRequest: findDraftReviewByRequestId, list: listDraftReviews, update: updateDraftReview, apply: updateGenerationVariationIfContentMatches };

function validOwner(ownerId: string) {
  if (!Types.ObjectId.isValid(ownerId)) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
}
function variation(generation: Generation, variationId: string) {
  const item = generation?.variations.find((candidate) => candidate._id.toString() === variationId);
  if (!generation || !item) throw new AppError(404, "DRAFT_NOT_FOUND", "Draft not found");
  return { generation, item };
}
function publicReview(review: Awaited<ReturnType<typeof findDraftReviewByIdAndOwner>>) {
  if (!review) throw new AppError(404, "DRAFT_REVIEW_NOT_FOUND", "Draft review not found");
  return { id: review._id.toString(), signalId: review.signalId.toString(), generationId: review.generationId.toString(), variationId: review.variationId.toString(), researchBriefId: review.researchBriefId.toString(), draftContent: review.draftContent, draftContentHash: review.draftContentHash, findings: review.findings, summary: review.summary, proposedDraft: review.proposedDraft, status: review.status, stale: review.stale, errorCode: review.errorCode ?? null, model: review.model, createdAt: review.createdAt, updatedAt: review.updatedAt };
}
async function assertBriefEvidenceCurrent(
  ownerId: string,
  brief: Awaited<ReturnType<typeof findResearchBriefByIdAndOwner>>,
  repository: DraftReviewRepository,
) {
  if (!brief) throw new AppError(404, "RESEARCH_BRIEF_NOT_FOUND", "Research brief not found");
  const snapshots = brief.sourceVersions.flatMap((item) =>
    item.sourceId && item.contentVersion
      ? [{ sourceId: item.sourceId, contentVersion: item.contentVersion }]
      : [],
  );
  const sources = await repository.findSources(ownerId, snapshots.map((item) => item.sourceId));
  const versions = new Map(snapshots.map((item) => [item.sourceId, item.contentVersion]));
  if (
    sources.length !== snapshots.length ||
    sources.some(
      (source) =>
        source.processingStatus !== "indexed" ||
        source.indexedContentVersion !== source.contentVersion ||
        versions.get(source._id.toString()) !== source.contentVersion,
    )
  ) {
    throw new AppError(409, "RESEARCH_BRIEF_STALE", "The research evidence is no longer current");
  }
}

export async function createDraftReviewForUser(ownerId: string, signalId: string, variationId: string, input: CreateReviewInput, client: DraftReviewClient = aiDraftReviewClient, repository: DraftReviewRepository = defaultRepository) {
  validOwner(ownerId);
  const signal = await repository.findSignal(ownerId, signalId);
  if (!signal) throw new AppError(404, "SIGNAL_NOT_FOUND", "Signal not found");
  const current = variation(await repository.findGeneration(ownerId, signalId), variationId);
  const brief = await repository.findBrief(ownerId, input.researchBriefId);
  if (!brief || brief.signalId.toString() !== signalId) throw new AppError(404, "RESEARCH_BRIEF_NOT_FOUND", "Research brief not found");
  if (!["succeeded", "no_evidence"].includes(brief.status) || brief.stale) throw new AppError(409, "RESEARCH_BRIEF_STALE", "Select a current completed research brief");
  await assertBriefEvidenceCurrent(ownerId, brief, repository);
  const inputFingerprint = hash(JSON.stringify({ variationId, briefId: input.researchBriefId, draft: current.item.content, briefUpdatedAt: brief.updatedAt }));
  const existing = await repository.findRequest(ownerId, input.requestId);
  if (existing) {
    if (existing.inputFingerprint !== inputFingerprint) throw new AppError(409, "REQUEST_KEY_REUSED", "This request key was already used with different inputs");
    return publicReview(existing);
  }

  let run;
  try {
    run = await repository.create({ ownerId, requestId: input.requestId, inputFingerprint, signalId, generationId: current.generation._id, variationId: current.item._id, researchBriefId: brief._id, draftContentHash: hash(current.item.content), draftContent: current.item.content, briefSnapshot: brief.evidence, findings: [], summary: "", proposedDraft: null, status: "running", stale: false, model: "pending" });
  } catch (error) {
    if (error instanceof Error && /duplicate|E11000/i.test(error.message)) {
      const duplicate = await repository.findRequest(ownerId, input.requestId);
      if (duplicate && duplicate.inputFingerprint === inputFingerprint) return publicReview(duplicate);
    }
    throw error;
  }
  let result;
  try {
    result = await client.review({ draft: current.item.content, evidence: brief.evidence.map((item) => ({ evidenceId: item.evidenceId, text: item.text })) });
  } catch (error) {
    await repository.update(run._id.toString(), { status: error instanceof AppError && error.statusCode === 504 ? "uncertain" : "failed", errorCode: error instanceof AppError ? error.code : "AI_SERVICE_ERROR" });
    throw error;
  }
  const evidenceIds = new Set(brief.evidence.map((item: { evidenceId: string }) => item.evidenceId));
  if (result.findings.some((finding) => finding.evidenceIds.some((id) => !evidenceIds.has(id))) || result.findings.some((finding) => !current.item.content.includes(finding.passage))) {
    await repository.update(run._id.toString(), { status: "failed", errorCode: "AI_INVALID_RESPONSE" });
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned invalid review references");
  }
  let sourceStale = false;
  try {
    await assertBriefEvidenceCurrent(ownerId, brief, repository);
  } catch (error) {
    if (error instanceof AppError && error.code === "RESEARCH_BRIEF_STALE") sourceStale = true;
    else throw error;
  }
  const after = variation(await repository.findGeneration(ownerId, signalId), variationId);
  const stale = sourceStale || after.item.content !== current.item.content || (await repository.findSignal(ownerId, signalId))?.revision !== signal.revision;
  const completed = await repository.update(run._id.toString(), { status: "succeeded", model: result.model, summary: result.summary, findings: result.findings, proposedDraft: result.proposedDraft, stale });
  return publicReview(completed);
}

export async function listDraftReviewsForUser(ownerId: string, signalId: string, variationId: string, repository = defaultRepository) {
  validOwner(ownerId);
  await findRequiredSignal(ownerId, signalId, repository);
  return (await repository.list(ownerId, signalId, variationId)).map((review) => publicReview(review));
}
export async function getDraftReviewForUser(ownerId: string, signalId: string, variationId: string, reviewId: string, repository = defaultRepository) {
  validOwner(ownerId);
  const review = await repository.findReview(ownerId, reviewId);
  if (!review) throw new AppError(404, "DRAFT_REVIEW_NOT_FOUND", "Draft review not found");
  if (review.signalId.toString() !== signalId || review.variationId.toString() !== variationId) throw new AppError(404, "DRAFT_REVIEW_NOT_FOUND", "Draft review not found");
  const current = await repository.findGeneration(ownerId, review.signalId.toString());
  const stale = !current || current.variations.find((item) => item._id.toString() === review.variationId.toString())?.content !== review.draftContent;
  if (stale !== review.stale) await repository.update(review._id.toString(), { stale });
  return publicReview(stale === review.stale ? review : { ...review, stale });
}
export async function applyDraftReviewForUser(ownerId: string, signalId: string, variationId: string, reviewId: string, input: ApplyReviewInput, repository = defaultRepository) {
  validOwner(ownerId);
  const review = await repository.findReview(ownerId, reviewId);
  if (!review || review.status !== "succeeded") throw new AppError(404, "DRAFT_REVIEW_NOT_FOUND", "Draft review not found");
  if (review.signalId.toString() !== signalId || review.variationId.toString() !== variationId) throw new AppError(404, "DRAFT_REVIEW_NOT_FOUND", "Draft review not found");
  if (review.stale || review.draftContentHash !== input.expectedContentHash) throw new AppError(409, "DRAFT_REVIEW_STALE", "This review no longer matches the current draft");
  const brief = await repository.findBrief(ownerId, review.researchBriefId.toString());
  await assertBriefEvidenceCurrent(ownerId, brief, repository);
  const updated = await repository.apply(ownerId, review.signalId.toString(), review.variationId.toString(), review.draftContent, input.content);
  if (!updated) throw new AppError(409, "DRAFT_REVIEW_STALE", "This review no longer matches the current draft");
  return updated;
}
async function findRequiredSignal(ownerId: string, signalId: string, repository: DraftReviewRepository) {
  const signal = await repository.findSignal(ownerId, signalId);
  if (!signal) throw new AppError(404, "SIGNAL_NOT_FOUND", "Signal not found");
  return signal;
}
