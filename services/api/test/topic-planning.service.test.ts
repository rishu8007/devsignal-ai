import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { AppError } from "../src/errors/app-error.js";
import { convertTopicToSignal, planTopicsForUser, type TopicPlanningRepository } from "../src/services/topic-planning.service.js";

const ownerId = new Types.ObjectId().toString();
const sourceId = new Types.ObjectId().toString();
const source = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(sourceId),
  title: "Indexed source",
  content: "A sufficiently long source body for planning.",
  contentVersion: 1,
  processingStatus: "indexed",
  indexedContentVersion: 1,
  indexedChunkerVersion: "chunker-1",
  indexedEmbeddingModel: "embedding-1",
  indexedDimensions: 1536,
  ...overrides,
});
const suggestion = (id = "idea-1", references = [sourceId]) => ({
  id,
  title: "A useful topic",
  angle: "Explain the practical trade-offs clearly.",
  relevance: "The selected source supports this discussion.",
  talkingPoints: ["Trade-offs", "Implementation"],
  sourceIds: references,
  missingEvidence: [],
});
function repository(overrides: Partial<TopicPlanningRepository> = {}): TopicPlanningRepository {
  const run = {
    _id: new Types.ObjectId(),
    ownerId: new Types.ObjectId(ownerId),
    requestId: "request-123456789",
    inputFingerprint: "",
    audience: "",
    contentGoal: "",
    sourceVersions: [{ sourceId, contentVersion: 1 }],
    suggestions: [suggestion()],
    model: "test-model",
    status: "succeeded",
    errorCode: null,
    stale: false,
    convertedSuggestionIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    findSources: async () => [source()] as never,
    createRun: async (input) => ({ ...run, ...input }) as never,
    findRun: async () => run as never,
    findRequest: async () => null,
    listRuns: async () => [[run], 1] as never,
    updateRun: async (_id, input) => ({ ...run, ...input }) as never,
    markConverted: async () => run as never,
    findPlanningSignal: async () => null,
    createPlanningSignal: async (_owner, input) => ({
      _id: new Types.ObjectId(),
      ...input,
      revision: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as never,
    ...overrides,
  };
}

test("rejects cross-owner or missing source access before planning", async () => {
  await assert.rejects(
    planTopicsForUser(ownerId, { requestId: "request-123456789", sourceIds: [sourceId], audience: "", contentGoal: "" }, { plan: async () => { throw new Error("provider called"); } }, repository({ findSources: async () => [] as never })),
    (error: unknown) => error instanceof AppError && error.code === "KNOWLEDGE_SOURCES_STALE",
  );
});

test("rejects unindexed sources and fabricated AI evidence", async () => {
  await assert.rejects(
    planTopicsForUser(ownerId, { requestId: "request-123456789", sourceIds: [sourceId], audience: "", contentGoal: "" }, { plan: async () => { throw new Error("provider called"); } }, repository({ findSources: async () => [source({ processingStatus: "pending" })] as never })),
    (error: unknown) => error instanceof AppError && error.code === "KNOWLEDGE_SOURCES_STALE",
  );
  const fabricatedClient = {
    plan: async () => ({
      model: "test",
      suggestions: [
        suggestion("idea-1", [new Types.ObjectId().toString()]),
        suggestion("idea-2"),
        suggestion("idea-3"),
      ],
    }),
  };
  await assert.rejects(
    planTopicsForUser(ownerId, { requestId: "request-223456789", sourceIds: [sourceId], audience: "", contentGoal: "" }, fabricatedClient, repository()),
    (error: unknown) => error instanceof AppError && error.code === "AI_INVALID_RESPONSE",
  );
});

test("rejects request-key reuse with different inputs", async () => {
  const runRepo = repository({ findRequest: async () => ({ inputFingerprint: "different" } as never) });
  await assert.rejects(
    planTopicsForUser(ownerId, { requestId: "request-123456789", sourceIds: [sourceId], audience: "", contentGoal: "" }, { plan: async () => { throw new Error("provider called"); } }, runRepo),
    (error: unknown) => error instanceof AppError && error.code === "REQUEST_KEY_REUSED",
  );
});

test("database claim prevents a second request with the same key from calling the provider", async () => {
  let claimed = false;
  let providerCalls = 0;
  const claimedRun = {
    _id: new Types.ObjectId(),
    inputFingerprint: "",
    status: "running",
    suggestions: [],
    sourceVersions: [{ sourceId, contentVersion: 1 }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const claimRepo = repository({
    findRequest: async () => claimed ? claimedRun as never : null,
    createRun: async (input) => {
      if (claimed) throw new Error("E11000 duplicate key");
      claimed = true;
      claimedRun.inputFingerprint = String(input.inputFingerprint);
      return claimedRun as never;
    },
  });
  const client = { plan: async () => { providerCalls += 1; return { model: "test", suggestions: [suggestion("idea-1"), suggestion("idea-2"), suggestion("idea-3")] }; } };
  await Promise.all([
    planTopicsForUser(ownerId, { requestId: "request-423456789", sourceIds: [sourceId], audience: "", contentGoal: "" }, client, claimRepo),
    planTopicsForUser(ownerId, { requestId: "request-423456789", sourceIds: [sourceId], audience: "", contentGoal: "" }, client, claimRepo),
  ]);
  assert.equal(providerCalls, 1);
});

test("duplicate conversion returns the persisted Signal and different suggestions convert independently", async () => {
  let creates = 0;
  const persisted = {
    _id: new Types.ObjectId(),
    topic: "Saved topic",
    notes: "Saved learning notes that are long enough for the Signal validation contract.",
    primaryAudience: "Developers & engineers",
    contentType: "Technical insight",
    revision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const runRepo = repository({
    findRun: async () => ({
      _id: new Types.ObjectId(),
      suggestions: [suggestion("idea-1"), suggestion("idea-2")],
      sourceVersions: [{ sourceId, contentVersion: 1 }],
      status: "succeeded",
      stale: false,
    }) as never,
    findPlanningSignal: async (_owner, _run, id) => id === "idea-1" && creates > 0 ? persisted as never : null,
    createPlanningSignal: async () => { creates += 1; return persisted as never; },
  });

  test("source changes during planning mark the saved run stale and conversion rechecks versions", async () => {
    let sourceReads = 0;
    const changingRepo = repository({
      findSources: async () => {
        sourceReads += 1;
        return [source({ contentVersion: sourceReads > 1 ? 2 : 1, indexedContentVersion: sourceReads > 1 ? 2 : 1 })] as never;
      },
    });
    const client = { plan: async () => ({ model: "test", suggestions: [suggestion("idea-1"), suggestion("idea-2"), suggestion("idea-3")] }) };
    const planned = await planTopicsForUser(ownerId, { requestId: "request-323456789", sourceIds: [sourceId], audience: "", contentGoal: "" }, client, changingRepo);
    assert.equal(planned.stale, true);
    await assert.rejects(
      convertTopicToSignal(ownerId, planned.id, {
        suggestionId: "idea-1",
        topic: "Edited topic",
        notes: "Edited learning notes that are long enough for the Signal validation contract.",
        primaryAudience: "Developers & engineers",
        contentType: "Technical insight",
      }, changingRepo),
      (error: unknown) => error instanceof AppError && error.code === "TOPIC_PLAN_STALE",
    );
  });
  const input = { suggestionId: "idea-1", topic: "Edited topic", notes: "Edited learning notes that are long enough for the Signal validation contract.", primaryAudience: "Developers & engineers" as const, contentType: "Technical insight" as const };
  const first = await convertTopicToSignal(ownerId, new Types.ObjectId().toString(), input, runRepo);
  const second = await convertTopicToSignal(ownerId, new Types.ObjectId().toString(), {
    ...input,
    suggestionId: "idea-2",
    topic: "Another edited topic",
  }, runRepo);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  const duplicate = await convertTopicToSignal(ownerId, new Types.ObjectId().toString(), input, runRepo);
  assert.equal(duplicate.duplicate, true);
  assert.equal(creates, 2);
});
