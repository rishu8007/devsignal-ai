import { Types } from "mongoose";
import { createHash } from "node:crypto";
import { AppError } from "../errors/app-error.js";
import { aiTopicPlanningClient, type TopicPlanningClient } from "../clients/topic-planning.client.js";
import { findKnowledgeSourcesByIdsAndOwner } from "../repositories/knowledge-source.repository.js";
import { createTopicPlanningRun, findTopicPlanningByIdAndOwner, findTopicPlanningByRequestId, listTopicPlanningByOwner, markTopicSuggestionConverted, updateTopicPlanningRun } from "../repositories/topic-planning.repository.js";
import { createSignal, findSignalByPlanning } from "../repositories/signal.repository.js";
import type { TopicConversionInput, TopicPlanningRequest } from "../validation/topic-planning.validation.js";
import { toPublicSignalDto, type PublicSignalDto } from "./signal.service.js";
import { admitAiOperation, completeAiOperation, markAiDispatched, markAiUncertain, releaseAiOperation } from "./usage.service.js";

export interface TopicPlanningRepository {
  findSources: typeof findKnowledgeSourcesByIdsAndOwner;
  createRun: typeof createTopicPlanningRun;
  findRun: typeof findTopicPlanningByIdAndOwner;
  findRequest: typeof findTopicPlanningByRequestId;
  listRuns: typeof listTopicPlanningByOwner;
  updateRun: typeof updateTopicPlanningRun;
  markConverted: typeof markTopicSuggestionConverted;
  findPlanningSignal: typeof findSignalByPlanning;
  createPlanningSignal: typeof createSignal;
}
const defaultRepository: TopicPlanningRepository = {
  findSources: findKnowledgeSourcesByIdsAndOwner,
  createRun: createTopicPlanningRun,
  findRun: findTopicPlanningByIdAndOwner,
  findRequest: findTopicPlanningByRequestId,
  listRuns: listTopicPlanningByOwner,
  updateRun: updateTopicPlanningRun,
  markConverted: markTopicSuggestionConverted,
  findPlanningSignal: findSignalByPlanning,
  createPlanningSignal: createSignal,
};

function ownerValid(ownerId: string) {
  if (!Types.ObjectId.isValid(ownerId)) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
}
function usableSources(sources: Awaited<ReturnType<typeof findKnowledgeSourcesByIdsAndOwner>>, ids: string[]) {
  if (sources.length !== ids.length || sources.some((source) => source.processingStatus !== "indexed" || source.indexedContentVersion !== source.contentVersion || !source.indexedChunkerVersion || !source.indexedEmbeddingModel || !source.indexedDimensions)) {
    throw new AppError(409, "KNOWLEDGE_SOURCES_STALE", "Select only existing, indexed sources at their current versions");
  }
  return sources;
}
function publicRun(run: Awaited<ReturnType<typeof findTopicPlanningByIdAndOwner>>) {
  if (!run) throw new AppError(404, "TOPIC_PLAN_NOT_FOUND", "Topic planning run not found");
  return {
    id: run._id.toString(), audience: run.audience, contentGoal: run.contentGoal, model: run.model,
    stale: run.stale, status: run.status, errorCode: run.errorCode ?? null,
    sourceVersions: run.sourceVersions, suggestions: run.suggestions,
    convertedSuggestionIds: run.convertedSuggestionIds, createdAt: run.createdAt, updatedAt: run.updatedAt,
  };
}
function inputFingerprint(input: TopicPlanningRequest): string {
  return createHash("sha256").update(JSON.stringify({
    sourceIds: input.sourceIds,
    audience: input.audience,
    contentGoal: input.contentGoal,
  })).digest("hex");
}
function markExpiredRun(run: Awaited<ReturnType<typeof findTopicPlanningByIdAndOwner>>, repository: TopicPlanningRepository) {
  if (!run || run.status !== "running" || Date.now() - run.updatedAt.getTime() < 10 * 60 * 1000) return run;
  return repository.updateRun(run._id.toString(), { status: "uncertain", errorCode: "PLANNING_OUTCOME_UNCERTAIN" });
}
export async function planTopicsForUser(ownerId: string, input: TopicPlanningRequest, client: TopicPlanningClient = aiTopicPlanningClient, repository = defaultRepository) {
  ownerValid(ownerId);
  const fingerprint = inputFingerprint(input);
  const existing = await markExpiredRun(await repository.findRequest(ownerId, input.requestId), repository);
  if (existing) {
    if (existing.inputFingerprint !== fingerprint) throw new AppError(409, "REQUEST_KEY_REUSED", "This request key was already used with different inputs");
    return publicRun(existing);
  }
  const ids = [...new Set(input.sourceIds)];
  if (ids.length !== input.sourceIds.length) throw new AppError(400, "VALIDATION_ERROR", "Source IDs must be unique");
  const sources = usableSources(await repository.findSources(ownerId, ids), ids);
  let run;
  try {
    run = await repository.createRun({
      ownerId, requestId: input.requestId, inputFingerprint: fingerprint, audience: input.audience,
      contentGoal: input.contentGoal, sourceVersions: sources.map((source) => ({ sourceId: source._id.toString(), contentVersion: source.contentVersion })),
      suggestions: [], model: "pending", status: "running", stale: false,
    });
  } catch (error) {
    if (error instanceof Error && /duplicate|E11000/i.test(error.message)) {
      const duplicate = await repository.findRequest(ownerId, input.requestId);
      if (duplicate) {
        if (duplicate.inputFingerprint !== fingerprint) throw new AppError(409, "REQUEST_KEY_REUSED", "This request key was already used with different inputs");
        return publicRun(duplicate);
      }
    }
    throw error;
  }
  let result;
  const admission = repository === defaultRepository ? await admitAiOperation(ownerId, `topic-planning:${input.requestId}`, "topic_planning") : null;
  if (admission?.duplicate) throw new AppError(409, "AI_OPERATION_IN_PROGRESS", "This AI operation is already in progress");
  if (admission) await markAiDispatched(admission.id);
  try {
    result = await client.plan({
      audience: input.audience,
      contentGoal: input.contentGoal,
      sources: sources.map((source) => ({ sourceId: source._id.toString(), contentVersion: source.contentVersion, title: source.title, text: source.content.slice(0, 4000) })),
    });
    if (admission) await completeAiOperation(admission.id, result.usage);
  } catch (error) {
    if (admission && error instanceof AppError && [502, 504].includes(error.statusCode)) await markAiUncertain(admission.id);
    else if (admission) await releaseAiOperation(admission.id);
    await repository.updateRun(run._id.toString(), {
      status: error instanceof AppError && error.statusCode === 504 ? "uncertain" : "failed",
      errorCode: error instanceof AppError ? error.code : "AI_SERVICE_ERROR",
    });
    throw error;
  }
  const supplied = new Set(ids);
  if (result.suggestions.some((suggestion) => suggestion.sourceIds.some((id) => !supplied.has(id)))) {
    await repository.updateRun(run._id.toString(), { status: "failed", errorCode: "AI_INVALID_RESPONSE" });
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned invalid source references");
  }
  const current = await repository.findSources(ownerId, ids);
  const stale = current.some((source) => source.contentVersion !== sources.find((item) => item._id.toString() === source._id.toString())?.contentVersion || source.processingStatus !== "indexed");
  const completed = await repository.updateRun(run._id.toString(), { status: "succeeded", model: result.model, suggestions: result.suggestions, stale });
  return publicRun(completed);
}
export async function listRecentTopicPlans(ownerId: string, page: number, limit: number, repository = defaultRepository) {
  ownerValid(ownerId);
  const [runs, total] = await repository.listRuns(ownerId, page, limit);
  return { runs: runs.map((run) => publicRun(run)), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
export async function convertTopicToSignal(ownerId: string, runId: string, input: TopicConversionInput, repository = defaultRepository): Promise<{ signal: PublicSignalDto; duplicate: boolean }> {
  ownerValid(ownerId);
  if (!Types.ObjectId.isValid(runId)) throw new AppError(400, "VALIDATION_ERROR", "Invalid request data");
  const run = await repository.findRun(ownerId, runId);
  if (!run) throw new AppError(404, "TOPIC_PLAN_NOT_FOUND", "Topic planning run not found");
  if (run.status !== "succeeded") throw new AppError(409, "TOPIC_PLAN_NOT_READY", "This topic plan is not ready for conversion");
  if (run.stale) throw new AppError(409, "TOPIC_PLAN_STALE", "Knowledge changed; create a fresh topic plan before converting");
  const suggestion = run.suggestions.find((item) => item.id === input.suggestionId);
  if (!suggestion) throw new AppError(404, "TOPIC_SUGGESTION_NOT_FOUND", "Topic suggestion not found");
  const duplicate = await repository.findPlanningSignal(ownerId, runId, input.suggestionId);
  if (duplicate) return { signal: toPublicSignalDto(duplicate), duplicate: true };
  const sourceVersions = run.sourceVersions.flatMap((item) => typeof item.sourceId === "string" && typeof item.contentVersion === "number" ? [{ sourceId: item.sourceId, contentVersion: item.contentVersion }] : []);
  const sourceIds = sourceVersions.map((item) => item.sourceId);
  const sources = usableSources(await repository.findSources(ownerId, sourceIds), sourceIds);
  if (sources.some((source) => source.contentVersion !== sourceVersions.find((item) => item.sourceId === source._id.toString())?.contentVersion)) {
    throw new AppError(409, "TOPIC_PLAN_STALE", "Knowledge changed; create a fresh topic plan before converting");
  }
  const { suggestionId: _suggestionId, ...signalInput } = input;
  let signal;
  try {
    signal = await repository.createPlanningSignal(ownerId, signalInput, { runId, suggestionId: input.suggestionId, sourceVersions });
  } catch (error) {
    if (error instanceof Error && /duplicate|E11000/i.test(error.message)) {
      const persisted = await repository.findPlanningSignal(ownerId, runId, input.suggestionId);
      if (persisted) return { signal: toPublicSignalDto(persisted), duplicate: true };
    }
    throw error;
  }
  await repository.markConverted(ownerId, runId, input.suggestionId);
  return { signal: toPublicSignalDto(signal), duplicate: false };
}
