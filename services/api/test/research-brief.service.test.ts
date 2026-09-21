import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { createHash } from "node:crypto";
import { AppError } from "../src/errors/app-error.js";
import { createResearchBriefForUser, type ResearchRepository } from "../src/services/research-brief.service.js";

const ownerId = new Types.ObjectId().toString();
const signalId = new Types.ObjectId().toString();
const sourceId = new Types.ObjectId().toString();
const signal = { _id: new Types.ObjectId(signalId), topic: "Reliable systems", notes: "A long enough Signal note for research brief generation and evidence grounding.", revision: 2 };
const source = (version = 1, status = "indexed") => ({ _id: new Types.ObjectId(sourceId), title: "Systems", content: "Evidence text for reliable systems.", contentVersion: version, processingStatus: status, indexedContentVersion: version, indexedChunkerVersion: "chunker", indexedEmbeddingModel: "embedding", indexedDimensions: 1536 });
function repo(overrides: Partial<ResearchRepository> = {}): ResearchRepository {
  const run = { _id: new Types.ObjectId(), signalId: new Types.ObjectId(signalId), signalRevision: 2, inputFingerprint: "hash", sourceVersions: [{ sourceId, contentVersion: 1 }], evidence: [], brief: { topicSummary: "", talkingPoints: [], claimAssessments: [], missingInformation: [], questions: [], limitations: [] }, status: "succeeded", stale: false, model: "test", createdAt: new Date(), updatedAt: new Date() };
  return {
    findSignal: async () => signal as never,
    findSources: async () => [source()] as never,
    createRun: async (input) => ({ ...run, ...input }) as never,
    findRun: async () => run as never,
    findRequest: async () => null,
    listRuns: async () => [[run], 1] as never,
    updateRun: async (_id, input) => ({ ...run, ...input }) as never,
    ...overrides,
  };
}
const request = { requestId: "research-12345678", sourceIds: [sourceId] };
const client = { research: async (input: { evidence: Array<{ evidenceId: string }> }) => ({ model: "test", noEvidence: input.evidence.length === 0, topicSummary: "Summary", talkingPoints: [{ text: "Point", evidenceIds: input.evidence.map((item) => item.evidenceId) }], claimAssessments: [], missingInformation: [], questions: [], limitations: [] }) };

test("rejects cross-owner signals and unindexed sources", async () => {
  await assert.rejects(createResearchBriefForUser(ownerId, signalId, request, undefined, undefined, repo({ findSignal: async () => null })), /Signal not found/);
  await assert.rejects(createResearchBriefForUser(ownerId, signalId, request, undefined, undefined, repo({ findSources: async () => [source(1, "pending")] as never })), (error: unknown) => error instanceof AppError && error.code === "KNOWLEDGE_SOURCES_STALE");
});

test("restricts retrieval to selected sources and rejects fabricated evidence", async () => {
  let retrievalInput: { ownerId: string; query: string; limit: number } | undefined;
  const retrieval = { retrieve: async (input: typeof retrievalInput) => { retrievalInput = input; return [{ sourceId, contentVersion: 1, chunkId: "chunk-1", chunkIndex: 0, text: "Evidence text for reliable systems.", startOffset: 0, endOffset: 35, score: 0.9 }]; } };
  const result = await createResearchBriefForUser(ownerId, signalId, request, retrieval, client, repo());
  assert.equal(retrievalInput?.limit, 8);
  assert.equal(result.evidence[0]?.quote, "Evidence text for reliable systems.");
  const fabricated = { research: async () => ({ model: "test", noEvidence: false, topicSummary: "Bad", talkingPoints: [{ text: "Bad", evidenceIds: ["forged"] }], claimAssessments: [], missingInformation: [], questions: [], limitations: [] }) };
  await assert.rejects(createResearchBriefForUser(ownerId, signalId, { ...request, requestId: "research-22345678" }, retrieval, fabricated, repo()), (error: unknown) => error instanceof AppError && error.code === "AI_INVALID_RESPONSE");
});

test("handles no evidence and prevents duplicate provider work", async () => {
  let calls = 0;
  const noEvidence = { research: async () => { calls += 1; return { model: "test", noEvidence: true, topicSummary: "No evidence", talkingPoints: [], claimAssessments: [], missingInformation: ["More detail"], questions: ["What happened?"], limitations: [] }; } };
  const result = await createResearchBriefForUser(ownerId, signalId, request, { retrieve: async () => [] }, noEvidence, repo());
  assert.equal(result.status, "no_evidence");
  assert.equal(calls, 1);
  const inputFingerprint = createHash("sha256").update(JSON.stringify({ ...request, signalRevision: signal.revision })).digest("hex");
  const duplicateRepo = repo({ findRequest: async () => ({ ...result, _id: new Types.ObjectId(result.id), signalId: new Types.ObjectId(signalId), inputFingerprint }) as never });
  const duplicate = await createResearchBriefForUser(ownerId, signalId, request, { retrieve: async () => { throw new Error("retrieval called"); } }, noEvidence, duplicateRepo);
  assert.equal(duplicate.id, result.id);
});

test("changed Signal or source versions mark the historical result stale", async () => {
  let reads = 0;
  const staleRepo = repo({
    findSignal: async () => ({ ...signal, revision: 2 }) as never,
    findSources: async () => { reads += 1; return [source(reads > 1 ? 2 : 1)] as never; },
  });
  const result = await createResearchBriefForUser(ownerId, signalId, request, { retrieve: async () => [] }, client, staleRepo);
  assert.equal(result.stale, true);
});
