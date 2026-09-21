import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import { aiResearchBriefClient, type ResearchBriefClient } from "../clients/research-brief.client.js";
import { aiRetrievalClient, type AiRetrievalClient } from "../clients/retrieval.client.js";
import { findKnowledgeSourcesByIdsAndOwner } from "../repositories/knowledge-source.repository.js";
import { findSignalByIdAndOwner } from "../repositories/signal.repository.js";
import { createResearchBrief, findResearchBriefByIdAndOwner, findResearchBriefByRequestId, listResearchBriefs, updateResearchBrief } from "../repositories/research-brief.repository.js";
import type { ResearchBriefRequest } from "../validation/research-brief.validation.js";

const MAX_EVIDENCE = 8;
const MAX_TOTAL_CONTEXT = 6000;
export interface ResearchRepository {
  findSignal: typeof findSignalByIdAndOwner;
  findSources: typeof findKnowledgeSourcesByIdsAndOwner;
  createRun: typeof createResearchBrief;
  findRun: typeof findResearchBriefByIdAndOwner;
  findRequest: typeof findResearchBriefByRequestId;
  listRuns: typeof listResearchBriefs;
  updateRun: typeof updateResearchBrief;
}
const defaultRepository: ResearchRepository = {
  findSignal: findSignalByIdAndOwner,
  findSources: findKnowledgeSourcesByIdsAndOwner,
  createRun: createResearchBrief,
  findRun: findResearchBriefByIdAndOwner,
  findRequest: findResearchBriefByRequestId,
  listRuns: listResearchBriefs,
  updateRun: updateResearchBrief,
};
function validOwner(ownerId: string) {
  if (!Types.ObjectId.isValid(ownerId)) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
}
function usableSources(sources: Awaited<ReturnType<typeof findKnowledgeSourcesByIdsAndOwner>>, ids: string[]) {
  if (sources.length !== ids.length || sources.some((source) => source.processingStatus !== "indexed" || source.indexedContentVersion !== source.contentVersion || !source.indexedChunkerVersion || !source.indexedEmbeddingModel || !source.indexedDimensions)) {
    throw new AppError(409, "KNOWLEDGE_SOURCES_STALE", "Select only existing, indexed sources at their current versions");
  }
  return sources;
}
function fingerprint(input: ResearchBriefRequest, signalRevision: number) {
  return createHash("sha256").update(JSON.stringify({ ...input, signalRevision })).digest("hex");
}
function publicBrief(brief: Awaited<ReturnType<typeof findResearchBriefByIdAndOwner>>) {
  if (!brief) throw new AppError(404, "RESEARCH_BRIEF_NOT_FOUND", "Research brief not found");
  return { id: brief._id.toString(), signalId: brief.signalId.toString(), signalRevision: brief.signalRevision, sourceVersions: brief.sourceVersions, evidence: brief.evidence, brief: brief.brief, status: brief.status, stale: brief.stale, errorCode: brief.errorCode ?? null, model: brief.model, createdAt: brief.createdAt, updatedAt: brief.updatedAt };
}
function validateEvidence(candidate: Awaited<ReturnType<typeof aiRetrievalClient.retrieve>>[number], sources: ReturnType<typeof usableSources>, allowed: Set<string>) {
  if (!allowed.has(candidate.sourceId)) return false;
  const source = sources.find((item) => item._id.toString() === candidate.sourceId);
  if (!source || source.contentVersion !== candidate.contentVersion || candidate.endOffset <= candidate.startOffset) return false;
  const codePoints = Array.from(source.content.replace(/\r\n?/g, "\n"));
  const text = codePoints.slice(candidate.startOffset, candidate.endOffset).join("");
  return text === candidate.text;
}

export async function createResearchBriefForUser(
  ownerId: string,
  signalId: string,
  input: ResearchBriefRequest,
  retrieval: AiRetrievalClient = aiRetrievalClient,
  client: ResearchBriefClient = aiResearchBriefClient,
  repository: ResearchRepository = defaultRepository,
) {
  validOwner(ownerId);
  if (!Types.ObjectId.isValid(signalId)) throw new AppError(400, "VALIDATION_ERROR", "Invalid request data");
  const signal = await repository.findSignal(ownerId, signalId);
  if (!signal) throw new AppError(404, "SIGNAL_NOT_FOUND", "Signal not found");
  const inputFingerprint = fingerprint(input, signal.revision);
  const existing = await repository.findRequest(ownerId, input.requestId);
  if (existing) {
    if (existing.inputFingerprint !== inputFingerprint) throw new AppError(409, "REQUEST_KEY_REUSED", "This request key was already used with different inputs");
    return publicBrief(existing);
  }
  const ids = [...new Set(input.sourceIds)];
  if (ids.length !== input.sourceIds.length) throw new AppError(400, "VALIDATION_ERROR", "Source IDs must be unique");
  const sources = usableSources(await repository.findSources(ownerId, ids), ids);
  let run;
  try {
    run = await repository.createRun({ ownerId, requestId: input.requestId, inputFingerprint, signalId, signalRevision: signal.revision, sourceVersions: sources.map((source) => ({ sourceId: source._id.toString(), contentVersion: source.contentVersion })), evidence: [], brief: { topicSummary: "", talkingPoints: [], claimAssessments: [], missingInformation: [], questions: [], limitations: [] }, status: "running", model: "pending", stale: false });
  } catch (error) {
    if (error instanceof Error && /duplicate|E11000/i.test(error.message)) {
      const duplicate = await repository.findRequest(ownerId, input.requestId);
      if (duplicate) {
        if (duplicate.inputFingerprint !== inputFingerprint) throw new AppError(409, "REQUEST_KEY_REUSED", "This request key was already used with different inputs");
        return publicBrief(duplicate);
      }
    }
    throw error;
  }
  let candidates;
  try {
    candidates = await retrieval.retrieve({ ownerId, query: `${signal.topic}\n${signal.notes}`, limit: MAX_EVIDENCE, sourceIds: ids, researchOnly: true });
  } catch (error) {
    await repository.updateRun(run._id.toString(), { status: error instanceof AppError && error.statusCode === 504 ? "uncertain" : "failed", errorCode: error instanceof AppError ? error.code : "RETRIEVAL_ERROR" });
    throw error;
  }
  const allowed = new Set(ids);
  const evidence = candidates.filter((candidate) => validateEvidence(candidate, sources, allowed)).slice(0, MAX_EVIDENCE).map((candidate, index) => ({
    evidenceId: `e${index + 1}`, sourceId: candidate.sourceId, contentVersion: candidate.contentVersion, chunkId: candidate.chunkId, chunkIndex: candidate.chunkIndex, text: candidate.text, score: candidate.score, quote: candidate.text,
  }));
  if (evidence.reduce((total, item) => total + item.text.length, 0) > MAX_TOTAL_CONTEXT) evidence.splice(Math.floor(MAX_TOTAL_CONTEXT / 1000));
  let result;
  try {
    result = await client.research({ topic: signal.topic, notes: signal.notes, evidence: evidence.map(({ quote: _quote, ...item }) => item) });
  } catch (error) {
    await repository.updateRun(run._id.toString(), { status: error instanceof AppError && error.statusCode === 504 ? "uncertain" : "failed", errorCode: error instanceof AppError ? error.code : "AI_SERVICE_ERROR" });
    throw error;
  }
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  if (result.talkingPoints.some((item) => item.evidenceIds.some((id) => !evidenceIds.has(id))) || result.claimAssessments.some((item) => item.evidenceIds.some((id) => !evidenceIds.has(id)))) {
    await repository.updateRun(run._id.toString(), { status: "failed", errorCode: "AI_INVALID_RESPONSE" });
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned invalid evidence references");
  }
  const currentSignal = await repository.findSignal(ownerId, signalId);
  const currentSources = await repository.findSources(ownerId, ids);
  const stale = !currentSignal || currentSignal.revision !== signal.revision || currentSources.length !== sources.length || currentSources.some((source) => source.contentVersion !== sources.find((item) => item._id.toString() === source._id.toString())?.contentVersion);
  const completed = await repository.updateRun(run._id.toString(), { status: result.noEvidence ? "no_evidence" : "succeeded", model: result.model, brief: result, evidence, stale });
  return publicBrief(completed);
}

export async function listResearchBriefsForUser(ownerId: string, signalId: string, page: number, limit: number, repository = defaultRepository) {
  validOwner(ownerId);
  const signal = await repository.findSignal(ownerId, signalId);
  if (!signal) throw new AppError(404, "SIGNAL_NOT_FOUND", "Signal not found");
  const [briefs, total] = await repository.listRuns(ownerId, signalId, page, limit);
  return { briefs: briefs.map((brief) => publicBrief(brief)), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
export async function getResearchBriefForUser(ownerId: string, briefId: string, repository = defaultRepository) {
  validOwner(ownerId);
  const brief = await repository.findRun(ownerId, briefId);
  if (!brief) throw new AppError(404, "RESEARCH_BRIEF_NOT_FOUND", "Research brief not found");
  const signal = await repository.findSignal(ownerId, brief.signalId.toString());
  const sourceIds = brief.sourceVersions.flatMap((item) => typeof item.sourceId === "string" ? [item.sourceId] : []);
  const sources = await repository.findSources(ownerId, sourceIds);
  const stale = !signal || signal.revision !== brief.signalRevision || sources.length !== brief.sourceVersions.length || sources.some((source) => source.contentVersion !== brief.sourceVersions.find((item) => item.sourceId === source._id.toString())?.contentVersion);
  if (stale !== brief.stale) await repository.updateRun(brief._id.toString(), { stale });
  return { ...publicBrief(brief), stale };
}
