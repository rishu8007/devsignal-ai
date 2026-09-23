import { createHash, randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import { aiContentWorkflowClient, type ContentWorkflowClient } from "../clients/content-workflow.client.js";
import { createGeneration, findGenerationByOwnerAndSignal } from "../repositories/generation.repository.js";
import { normalizeAiGenerationResult } from "./generation.service.js";
import { findKnowledgeSourcesByIdsAndOwner } from "../repositories/knowledge-source.repository.js";
import { createResearchBriefForUser } from "./research-brief.service.js";
import { createDraftReviewForUser } from "./draft-review.service.js";
import { findSignalByIdAndOwner } from "../repositories/signal.repository.js";
import {
  claimNextContentWorkflow,
  claimContentWorkflowApproval,
  createContentWorkflow,
  findContentWorkflowByIdAndOwner,
  findContentWorkflowByRequestId,
  listContentWorkflows,
  markExpiredContentWorkflowsUncertain,
  updateContentWorkflow,
  updateClaimedContentWorkflow,
  addContentWorkflowReview,
} from "../repositories/content-workflow.repository.js";
import { createDraftReview, findDraftReviewByIdAndOwner, findDraftReviewByRequestId } from "../repositories/draft-review.repository.js";
import type { ApprovalInput, StartWorkflowInput } from "../validation/content-workflow.validation.js";
import type { GenerationAngle } from "../types/generation.js";
import {
  admitAiOperation,
  completeAiOperation,
  markAiDispatched,
  markAiUncertain,
  releaseAiOperation,
  type UsageRepositoryBoundary,
} from "./usage.service.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const leaseDurationMs = 90_000;

export async function advanceWorkflowProviderStep(
  ownerId: string,
  workflowId: string,
  step: "generation" | "draft_review",
  input: Record<string, unknown>,
  client: ContentWorkflowClient,
  usageRepository?: UsageRepositoryBoundary,
) {
  const operationKey = `workflow:${workflowId}:${step}`;
  const admission = await admitAiOperation(
    ownerId,
    operationKey,
    step,
    new Date(),
    usageRepository,
  );
  if (admission.duplicate) {
    throw new AppError(409, "AI_OPERATION_IN_PROGRESS", "This workflow AI step is already in progress");
  }
  await markAiDispatched(admission.id, new Date(), usageRepository);
  let result: Awaited<ReturnType<ContentWorkflowClient["advance"]>>;
  try {
    result = await client.advance(input);
  } catch (error) {
    if (error instanceof AppError && [502, 504].includes(error.statusCode)) {
      await markAiUncertain(admission.id, usageRepository);
    } else {
      await releaseAiOperation(admission.id, usageRepository);
    }
    throw error;
  }
  const usage = result.usage ?? (
    step === "generation"
      ? (result.state.generation as { usage?: unknown } | undefined)?.usage
      : (result.state.review as { usage?: unknown } | undefined)?.usage
  );
  await completeAiOperation(admission.id, usage as Parameters<typeof completeAiOperation>[1], usageRepository);
  return result;
}

export function workflowReviewRequestId(
  ownerId: string,
  workflowId: string,
  generationId: string,
  variationId: string,
  draftContentHash: string,
  researchBriefId: string,
  sourceVersions: Array<{ sourceId: string; contentVersion: number }>,
  evidence: unknown,
) {
  const evidenceFingerprint = hash(JSON.stringify(evidence));
  return `workflow-review-${hash(JSON.stringify({
    ownerId,
    workflowId,
    generationId,
    variationId,
    draftContentHash,
    researchBriefId,
    sourceVersions,
    evidenceFingerprint,
  }))}`;
}

export interface WorkflowReviewBoundary {
  findWorkflow: typeof findContentWorkflowByIdAndOwner;
  findGeneration: typeof findGenerationByOwnerAndSignal;
  findSources: typeof findKnowledgeSourcesByIdsAndOwner;
  findSignal: typeof findSignalByIdAndOwner;
  createReview: typeof createDraftReviewForUser;
  addReview: typeof addContentWorkflowReview;
  findLegacyReview: typeof findDraftReviewByRequestId;
}

const defaultWorkflowReviewBoundary: WorkflowReviewBoundary = {
  findWorkflow: findContentWorkflowByIdAndOwner,
  findGeneration: findGenerationByOwnerAndSignal,
  findSources: findKnowledgeSourcesByIdsAndOwner,
  findSignal: findSignalByIdAndOwner,
  createReview: createDraftReviewForUser,
  addReview: addContentWorkflowReview,
  findLegacyReview: findDraftReviewByRequestId,
};

interface WorkflowEvidence {
  evidenceId: string;
  sourceId: string;
  title: string;
  contentVersion: number;
  chunkId: string;
  chunkIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  score: number;
}

interface WorkflowGenerationOutput {
  model: string;
  variations: Array<{ angle: GenerationAngle; content: string; citations: string[] }>;
}

export interface WorkflowReviewBinding {
  variationId: string;
  reviewId: string;
  draftContentHash: string;
  stale: boolean;
  status: string;
}

export function findCurrentWorkflowReview(
  bindings: WorkflowReviewBinding[],
  variationId: string,
  draftContentHash: string,
) {
  return bindings.find(
    (binding) =>
      binding.variationId === variationId &&
      binding.draftContentHash === draftContentHash &&
      binding.stale === false &&
      binding.status === "succeeded",
  );
}

export function mapWorkflowGenerationCitations(
  researchEvidence: WorkflowEvidence[],
  generationOutput: WorkflowGenerationOutput,
  sourceTitles: Map<string, string>,
) {
  return normalizeAiGenerationResult(
    { model: generationOutput.model, variations: generationOutput.variations },
    true,
    new Map(
      researchEvidence.map((item) => [
        item.chunkId,
        {
          sourceId: item.sourceId,
          title: sourceTitles.get(item.sourceId) ?? item.title,
          contentVersion: item.contentVersion,
          chunkId: item.chunkId,
          chunkIndex: item.chunkIndex,
          text: item.text,
          startOffset: item.startOffset,
          endOffset: item.endOffset,
          score: item.score,
        },
      ]),
    ),
  );
}

function ownerIsValid(ownerId: string) {
  if (!Types.ObjectId.isValid(ownerId)) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
}
function publicWorkflow(run: Awaited<ReturnType<typeof findContentWorkflowByIdAndOwner>>) {
  if (!run) throw new AppError(404, "WORKFLOW_NOT_FOUND", "Content workflow not found");
  return {
    id: run._id.toString(),
    signalId: run.signalId.toString(),
    status: run.status,
    phase: run.phase,
    sourceVersions: run.sourceVersions,
    researchBriefId: run.researchBriefId?.toString() ?? null,
    generationId: run.generationId?.toString() ?? null,
    reviewIds: run.reviewIds.map((id) => id.toString()),
    reviewBindings: run.reviewBindings ?? [],
    researchOutput: run.researchOutput,
    generationOutput: run.generationOutput,
    reviewOutput: run.reviewOutput,
    approvedVariationId: run.approvedVariationId?.toString() ?? null,
    errorCode: run.errorCode ?? null,
    cancellationRequested: run.cancellationRequested,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export async function startContentWorkflowForUser(ownerId: string, signalId: string, input: StartWorkflowInput) {
  ownerIsValid(ownerId);
  const signal = await findSignalByIdAndOwner(ownerId, signalId);
  if (!signal) throw new AppError(404, "SIGNAL_NOT_FOUND", "Signal not found");
  const sources = await findKnowledgeSourcesByIdsAndOwner(ownerId, input.sourceIds);
  if (
    sources.length !== input.sourceIds.length ||
    sources.some((source) => source.processingStatus !== "indexed" || source.indexedContentVersion !== source.contentVersion)
  ) {
    throw new AppError(409, "KNOWLEDGE_SOURCES_STALE", "Select only current indexed Knowledge sources");
  }
  const sourceVersions = sources.map((source) => ({ sourceId: source._id.toString(), contentVersion: source.contentVersion }));
  const inputSnapshot = { topic: signal.topic, notes: signal.notes, primaryAudience: signal.primaryAudience, contentType: signal.contentType, sourceIds: input.sourceIds };
  const inputFingerprint = hash(JSON.stringify({ inputSnapshot, signalRevision: signal.revision, sourceVersions }));
  const existing = await findContentWorkflowByRequestId(ownerId, input.requestId);
  if (existing) {
    if (existing.inputFingerprint !== inputFingerprint) throw new AppError(409, "REQUEST_KEY_REUSED", "This request key was already used with different inputs");
    return publicWorkflow(existing);
  }
  try {
    const run = await createContentWorkflow({
      ownerId,
      requestId: input.requestId,
      inputFingerprint,
      signalId,
      signalRevision: signal.revision,
      sourceVersions,
      threadId: randomUUID(),
      inputSnapshot,
      status: "queued",
      phase: "research",
      reviewIds: [],
    });
    return publicWorkflow(run);
  } catch (error) {
    if (error instanceof Error && /duplicate|E11000/i.test(error.message)) {
      const duplicate = await findContentWorkflowByRequestId(ownerId, input.requestId);
      if (duplicate && duplicate.inputFingerprint === inputFingerprint) return publicWorkflow(duplicate);
    }
    throw error;
  }
}

export async function getContentWorkflowForUser(ownerId: string, signalId: string, workflowId: string) {
  ownerIsValid(ownerId);
  const run = await findContentWorkflowByIdAndOwner(ownerId, workflowId);
  if (run && run.signalId.toString() !== signalId) throw new AppError(404, "WORKFLOW_NOT_FOUND", "Content workflow not found");
  return publicWorkflow(run);
}

export async function listContentWorkflowsForUser(ownerId: string, signalId: string) {
  ownerIsValid(ownerId);
  return (await listContentWorkflows(ownerId, signalId)).map(publicWorkflow);
}

export async function createContentWorkflowReviewForUser(
  ownerId: string,
  signalId: string,
  workflowId: string,
  input: { requestId: string; variationId: string },
  boundary: WorkflowReviewBoundary = defaultWorkflowReviewBoundary,
) {
  ownerIsValid(ownerId);
  const run = await boundary.findWorkflow(ownerId, workflowId);
  if (!run || run.signalId.toString() !== signalId) {
    throw new AppError(404, "WORKFLOW_NOT_FOUND", "Content workflow not found");
  }
  if (run.status !== "awaiting_approval" || !run.generationId || !run.researchBriefId) {
    throw new AppError(409, "WORKFLOW_NOT_READY_FOR_REVIEW", "This workflow is not ready for variation review");
  }
  const generation = await boundary.findGeneration(ownerId, signalId);
  const selected = generation?.variations.find((item) => item._id.toString() === input.variationId);
  if (!generation || generation._id.toString() !== run.generationId.toString() || !selected) {
    throw new AppError(404, "WORKFLOW_VARIATION_NOT_FOUND", "The selected draft variation was not found");
  }
  const sourceIds = run.sourceVersions
    .map((item) => item.sourceId)
    .filter((sourceId): sourceId is string => typeof sourceId === "string");
  const currentSources = await boundary.findSources(ownerId, sourceIds);
  const signal = await boundary.findSignal(ownerId, signalId);
  if (
    !signal ||
    signal.revision !== run.signalRevision ||
    currentSources.length !== run.sourceVersions.length ||
    currentSources.some((source) =>
      source.processingStatus !== "indexed" ||
      source.indexedContentVersion !== source.contentVersion ||
      !source.indexedChunkerVersion ||
      !source.indexedEmbeddingModel ||
      !source.indexedDimensions ||
      run.sourceVersions.find((item) => item.sourceId === source._id.toString())?.contentVersion !== source.contentVersion,
    )
  ) {
    throw new AppError(409, "WORKFLOW_STALE", "Workflow inputs changed; refresh the workflow before reviewing");
  }
  const existingBinding = findCurrentWorkflowReview(run.reviewBindings ?? [], input.variationId, hash(selected.content));
  if (existingBinding) return publicWorkflow(run);
  const draftContentHash = hash(selected.content);
  const legacyReview = await boundary.findLegacyReview(ownerId, `workflow-${workflowId}-review-${input.variationId}`);
  if (
    legacyReview &&
    legacyReview.signalId.toString() === signalId &&
    legacyReview.generationId.toString() === generation._id.toString() &&
    legacyReview.variationId.toString() === selected._id.toString() &&
    legacyReview.researchBriefId.toString() === run.researchBriefId.toString() &&
    legacyReview.draftContentHash === draftContentHash
  ) {
    const updatedLegacy = await boundary.addReview(workflowId, legacyReview._id, {
      variationId: legacyReview.variationId.toString(),
      reviewId: legacyReview._id.toString(),
      draftContentHash: legacyReview.draftContentHash,
      stale: legacyReview.stale,
      status: legacyReview.status,
      summary: legacyReview.summary,
      findings: legacyReview.findings,
      proposedDraft: legacyReview.proposedDraft,
      model: legacyReview.model,
    });
    return publicWorkflow(updatedLegacy);
  }
  const requestId = workflowReviewRequestId(
    ownerId,
    workflowId,
    generation._id.toString(),
    selected._id.toString(),
    draftContentHash,
    run.researchBriefId.toString(),
    run.sourceVersions
      .map((item) => item.sourceId && item.contentVersion
        ? { sourceId: item.sourceId, contentVersion: item.contentVersion }
        : null)
      .filter((item): item is { sourceId: string; contentVersion: number } => item !== null),
    run.researchOutput?.evidence ?? [],
  );
  const review = await boundary.createReview(ownerId, signalId, input.variationId, {
    requestId,
    researchBriefId: run.researchBriefId.toString(),
  });
  const latest = await boundary.findWorkflow(ownerId, workflowId);
  if (!latest || latest.status !== "awaiting_approval") {
    throw new AppError(409, "WORKFLOW_CANCELLED", "The workflow changed while the review was running");
  }
  const updated = await boundary.addReview(workflowId, review.id, {
    variationId: review.variationId,
    reviewId: review.id,
    draftContentHash: review.draftContentHash,
    stale: review.stale,
    status: review.status,
    summary: review.summary,
    findings: review.findings,
    proposedDraft: review.proposedDraft,
    model: review.model,
  });
  return publicWorkflow(updated);
}

export async function cancelContentWorkflowForUser(ownerId: string, signalId: string, workflowId: string) {
  ownerIsValid(ownerId);
  const run = await findContentWorkflowByIdAndOwner(ownerId, workflowId);
  if (!run) throw new AppError(404, "WORKFLOW_NOT_FOUND", "Content workflow not found");
  if (run.signalId.toString() !== signalId) throw new AppError(404, "WORKFLOW_NOT_FOUND", "Content workflow not found");
  if (["completed", "cancelled", "uncertain", "failed", "stale"].includes(run.status)) return publicWorkflow(run);
  const updated = await updateContentWorkflow(workflowId, { cancellationRequested: true, status: "cancelled", phase: "cancelled" });
  return publicWorkflow(updated);
}

export async function approveContentWorkflowForUser(ownerId: string, signalId: string, workflowId: string, input: ApprovalInput, client: ContentWorkflowClient = aiContentWorkflowClient) {
  ownerIsValid(ownerId);
  const run = await findContentWorkflowByIdAndOwner(ownerId, workflowId);
  if (!run || run.status !== "awaiting_approval") throw new AppError(409, "WORKFLOW_NOT_AWAITING_APPROVAL", "This workflow is not awaiting approval");
  if (run.signalId.toString() !== signalId) throw new AppError(404, "WORKFLOW_NOT_FOUND", "Content workflow not found");
  const signal = await findSignalByIdAndOwner(ownerId, run.signalId.toString());
  const sourceIds = run.sourceVersions.flatMap((item) => (item.sourceId ? [item.sourceId] : []));
  const sources = await findKnowledgeSourcesByIdsAndOwner(ownerId, sourceIds);
  if (!signal || signal.revision !== run.signalRevision || sources.length !== run.sourceVersions.length || sources.some((source) => source.processingStatus !== "indexed" || source.indexedContentVersion !== source.contentVersion || !source.indexedChunkerVersion || !source.indexedEmbeddingModel || !source.indexedDimensions || run.sourceVersions.find((item) => item.sourceId === source._id.toString())?.contentVersion !== source.contentVersion)) {
    await updateContentWorkflow(workflowId, { status: "stale", phase: "approval" });
    throw new AppError(409, "WORKFLOW_STALE", "Workflow inputs changed; fresh research is required");
  }
  const generation = await findGenerationByOwnerAndSignal(ownerId, run.signalId.toString());
  const variation = generation?.variations.find((item) => item._id.toString() === input.variationId);
  if (!variation || hash(variation.content) !== input.draftHash) throw new AppError(409, "WORKFLOW_DRAFT_STALE", "The selected draft changed; review it again");
  const reviewId = findCurrentWorkflowReview(run.reviewBindings ?? [], variation._id.toString(), input.draftHash)?.reviewId;
  const review = reviewId ? await findDraftReviewByIdAndOwner(ownerId, reviewId) : null;
  if (!review || review.signalId.toString() !== run.signalId.toString() || review.generationId.toString() !== generation?._id.toString() || review.researchBriefId.toString() !== run.researchBriefId?.toString() || review.variationId.toString() !== variation._id.toString() || review.draftContentHash !== input.draftHash || review.stale || review.status !== "succeeded") {
    throw new AppError(409, "WORKFLOW_REVIEW_STALE", "The selected draft does not have a current review");
  }
  const approved = await claimContentWorkflowApproval(workflowId, { status: "running", phase: "approval", approvedVariationId: variation._id, approvedDraftHash: input.draftHash });
  if (!approved) throw new AppError(409, "WORKFLOW_CONFLICT", "Workflow approval could not be claimed");
  try {
    const result = await client.advance({
      threadId: run.threadId,
      ownerId,
      topic: run.inputSnapshot.topic,
      notes: run.inputSnapshot.notes,
      primaryAudience: run.inputSnapshot.primaryAudience,
      contentType: run.inputSnapshot.contentType,
      evidence: (run.researchOutput?.evidence ?? []).map((item: Record<string, unknown>) => ({ evidenceId: item.evidenceId, sourceId: item.sourceId, contentVersion: item.contentVersion, chunkId: item.chunkId, chunkIndex: item.chunkIndex, text: item.text })),
      resume: true,
      approval: { variationId: input.variationId, draftHash: input.draftHash },
    });
    const completed = await updateContentWorkflow(workflowId, { status: result.status === "completed" ? "completed" : "failed", phase: result.status === "completed" ? "completed" : "approval" });
    return publicWorkflow(completed);
  } catch (error) {
    await updateContentWorkflow(workflowId, { status: error instanceof AppError && error.statusCode === 504 ? "uncertain" : "failed", errorCode: error instanceof AppError ? error.code : "AI_SERVICE_ERROR" });
    throw error;
  }
}

async function advanceClaimedWorkflow(run: NonNullable<Awaited<ReturnType<typeof claimNextContentWorkflow>>>, client: ContentWorkflowClient) {
  const snapshot = run.inputSnapshot as { topic: string; notes: string; primaryAudience: string; contentType: string; sourceIds: string[] };
  const research = await createResearchBriefForUser(
    run.ownerId.toString(),
    run.signalId.toString(),
    { requestId: `workflow-${run._id.toString()}-research`, sourceIds: snapshot.sourceIds },
  );
  if (research.status === "no_evidence") {
    await updateClaimedContentWorkflow(run._id.toString(), run.leaseId as string, {
      status: "awaiting_research",
      phase: "research",
      errorCode: "NO_RELIABLE_EVIDENCE",
      researchBriefId: research.id,
      researchOutput: research,
      leaseId: null,
      leaseExpiresAt: null,
    });
    return null;
  }
  if (research.status !== "succeeded" || research.stale) {
    throw new AppError(409, "WORKFLOW_RESEARCH_UNAVAILABLE", "Research is not complete and will not be replayed automatically");
  }
  const beforeAi = await findContentWorkflowByIdAndOwner(run.ownerId.toString(), run._id.toString());
  if (!beforeAi || beforeAi.status !== "running" || beforeAi.leaseId !== run.leaseId) return null;
  const graphInput = {
    threadId: run.threadId,
    ownerId: run.ownerId.toString(),
    topic: snapshot.topic,
    notes: snapshot.notes,
    primaryAudience: snapshot.primaryAudience,
    contentType: snapshot.contentType,
    evidence: research.evidence,
    research,
    resume: false,
  };
  let result = run.generationOutput
    ? await client.advance(graphInput)
    : await advanceWorkflowProviderStep(
      run.ownerId.toString(),
      run._id.toString(),
      "generation",
      graphInput,
      client,
    );
  if (!(await persistWorkflowGraphState(run, result))) return null;
  while (isWorkflowStepInterrupt(result.interrupt)) {
    const betweenSteps = await findContentWorkflowByIdAndOwner(run.ownerId.toString(), run._id.toString());
    if (!betweenSteps || betweenSteps.status !== "running" || betweenSteps.leaseId !== run.leaseId) return null;
    result = run.reviewOutput
      ? await client.advance({ ...graphInput, resume: true })
      : await advanceWorkflowProviderStep(
        run.ownerId.toString(),
        run._id.toString(),
        "draft_review",
        { ...graphInput, resume: true },
        client,
      );
    if (!(await persistWorkflowGraphState(run, result))) return null;
  }
  const state = result.state as Record<string, any>;
  const afterAi = await findContentWorkflowByIdAndOwner(run.ownerId.toString(), run._id.toString());
  if (!afterAi || afterAi.status !== "running" || afterAi.leaseId !== run.leaseId) return null;
  const generationOutput = state.generation;
  const reviewOutput = state.review;
  const evidenceIds = new Set(research.evidence.map((item) => item.evidenceId));
  const sourceIds = run.sourceVersions
    .map((item) => item.sourceId)
    .filter((sourceId): sourceId is string => typeof sourceId === "string");
  const sourceDocuments = await findKnowledgeSourcesByIdsAndOwner(run.ownerId.toString(), sourceIds);
  const sourceTitles = new Map(sourceDocuments.map((source) => [source._id.toString(), source.title]));
  const workflowEvidence: WorkflowEvidence[] = research.evidence.map((item) => ({
    evidenceId: item.evidenceId,
    sourceId: item.sourceId.toString(),
    title: item.title,
    contentVersion: item.contentVersion,
    chunkId: item.chunkId,
    chunkIndex: item.chunkIndex,
    text: item.text,
    startOffset: item.startOffset,
    endOffset: item.endOffset,
    score: item.score,
  }));
  const mappedGeneration = mapWorkflowGenerationCitations(workflowEvidence, generationOutput, sourceTitles);
  const technicalDraft = generationOutput.variations.find(
    (item: Record<string, unknown>) => item.angle === "technical_depth",
  )?.content ?? generationOutput.variations[0]?.content;
  if (
    typeof technicalDraft !== "string" ||
    reviewOutput.findings.some(
      (finding: Record<string, unknown>) =>
        (finding.evidenceIds as string[]).some((id) => !evidenceIds.has(id)) ||
        !technicalDraft.includes(finding.passage as string),
    )
  ) {
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned invalid review references");
  }

  async function persistWorkflowGraphState(
    run: NonNullable<Awaited<ReturnType<typeof claimNextContentWorkflow>>>,
    result: Awaited<ReturnType<ContentWorkflowClient["advance"]>>,
  ): Promise<boolean> {
    const state = result.state as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if (state.generation) {
      update.generationOutput = state.generation;
      update.phase = "write";
    }
    if (state.review) {
      update.reviewOutput = state.review;
      update.phase = "review";
    }
    if (Object.keys(update).length === 0) return true;
    return Boolean(
      await updateClaimedContentWorkflow(run._id.toString(), run.leaseId as string, update),
    );
  }

  function isWorkflowStepInterrupt(value: unknown): value is { kind: "workflow_step" } {
    return typeof value === "object" && value !== null && "kind" in value && value.kind === "workflow_step";
  }
  const generation = await createGeneration(
    run.ownerId.toString(),
    run.signalId.toString(),
    { topic: snapshot.topic, notes: snapshot.notes, primaryAudience: snapshot.primaryAudience as never, contentType: snapshot.contentType as never },
    mappedGeneration,
  );
  const technical = generation.variations.find((item) => item.angle === "technical_depth") ?? generation.variations[0];
  if (!technical) throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned no drafts");
  const review = await createDraftReview({
    ownerId: run.ownerId,
    requestId: `workflow-${run._id.toString()}-review`,
    inputFingerprint: hash(JSON.stringify({ workflowId: run._id.toString(), generationId: generation._id.toString() })),
    signalId: run.signalId,
    generationId: generation._id,
    variationId: technical._id,
    researchBriefId: research.id,
    draftContentHash: hash(technical.content),
    draftContent: technical.content,
    briefSnapshot: research.evidence,
    findings: reviewOutput.findings,
    summary: reviewOutput.summary,
    proposedDraft: reviewOutput.proposedDraft,
    status: "succeeded",
    stale: false,
    model: reviewOutput.model,
  });
  const technicalReviewBinding = {
    variationId: technical._id.toString(),
    reviewId: review._id.toString(),
    draftContentHash: hash(technical.content),
    stale: false,
    status: "succeeded",
    summary: reviewOutput.summary,
    findings: reviewOutput.findings,
    proposedDraft: reviewOutput.proposedDraft,
    model: reviewOutput.model,
  };
  return updateClaimedContentWorkflow(run._id.toString(), run.leaseId as string, {
    status: "awaiting_approval",
    phase: "approval",
    researchBriefId: research.id,
    generationId: generation._id,
    reviewIds: [review._id],
    reviewBindings: [technicalReviewBinding],
    researchOutput: research,
    generationOutput: {
      ...generationOutput,
      variations: generation.variations.map((item) => ({
        id: item._id.toString(),
        angle: item.angle,
        content: item.content,
      })),
    },
    reviewOutput,
    leaseId: null,
    leaseExpiresAt: null,
  });
}

export function startContentWorkflowWorker(intervalMs = 2000) {
  const timer = setInterval(() => {
    void markExpiredContentWorkflowsUncertain(new Date()).then(async () => {
      const leaseId = randomUUID();
      const run = await claimNextContentWorkflow(leaseId, new Date(Date.now() + leaseDurationMs));
      if (!run) return;
      try {
        await advanceClaimedWorkflow(run, aiContentWorkflowClient);
      } catch (error) {
        await updateClaimedContentWorkflow(run._id.toString(), leaseId, { status: error instanceof AppError && error.statusCode === 504 ? "uncertain" : "failed", phase: run.phase, errorCode: error instanceof AppError ? error.code : "WORKFLOW_FAILED", leaseId: null, leaseExpiresAt: null });
      }
    }).catch(() => undefined);
  }, intervalMs);
  return () => clearInterval(timer);
}
