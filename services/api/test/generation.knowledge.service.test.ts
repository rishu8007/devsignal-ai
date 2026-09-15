import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import type { AiGenerationClient } from "../src/clients/ai-service.client.js";
import type { SignalDocument } from "../src/models/signal.model.js";
import type { GenerationDocument } from "../src/models/generation.model.js";
import {
  createGenerationForSignal,
  type GenerationRepositoryBoundary,
  type RetrievalBoundary,
} from "../src/services/generation.service.js";
import type {
  AiGenerationResult,
  GenerationContextChunk,
  GenerationSource,
  MappedGenerationResult,
} from "../src/types/generation.js";
import type { PublicRetrievalCandidate } from "../src/services/knowledge-source-retrieval.service.js";

const ownerId = "507f1f77bcf86cd799439011";
const signalId = "507f1f77bcf86cd799439013";
const otherSourceId = "507f1f77bcf86cd799439099";

const source: GenerationSource = {
  topic: "Connecting an authenticated dashboard",
  notes: "I connected the dashboard form to an authenticated Express API and verified the flow.",
  primaryAudience: "Developers & engineers",
  contentType: "Build in public",
};

function makeSignal(overrides: Partial<SignalDocument> = {}): SignalDocument {
  return {
    _id: new Types.ObjectId(signalId),
    topic: source.topic,
    notes: source.notes,
    primaryAudience: source.primaryAudience,
    contentType: source.contentType,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SignalDocument;
}

function candidate(overrides: Partial<PublicRetrievalCandidate> = {}): PublicRetrievalCandidate {
  return {
    sourceId: "507f1f77bcf86cd799439012",
    title: "Runbook",
    contentVersion: 2,
    chunkId: "507f1f77bcf86cd799439012_v2_c0",
    chunkIndex: 0,
    text: "Rotate the credential before redeploying.",
    startOffset: 0,
    endOffset: 42,
    score: 0.87,
    ...overrides,
  };
}

function makeGeneration(): GenerationDocument {
  return {
    _id: new Types.ObjectId("507f1f77bcf86cd799439014"),
    ownerId: new Types.ObjectId(ownerId),
    signalId: new Types.ObjectId(signalId),
    source,
    model: "gpt-5-mini",
    usedKnowledge: false,
    variations: [
      {
        _id: new Types.ObjectId("507f1f77bcf86cd799439015"),
        angle: "technical_depth",
        content: "t".repeat(100),
        status: "draft",
        citations: [],
      },
      {
        _id: new Types.ObjectId("507f1f77bcf86cd799439016"),
        angle: "learning_story",
        content: "l".repeat(100),
        status: "draft",
        citations: [],
      },
      {
        _id: new Types.ObjectId("507f1f77bcf86cd799439017"),
        angle: "professional_impact",
        content: "p".repeat(100),
        status: "draft",
        citations: [],
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as GenerationDocument;
}

function groundedResult(citations: string[] = [candidate().chunkId]): AiGenerationResult {
  return {
    model: "gpt-5-mini",
    variations: [
      { angle: "professional_impact", content: "p".repeat(100), citations },
      { angle: "technical_depth", content: "t".repeat(100), citations },
      { angle: "learning_story", content: "l".repeat(100), citations },
    ],
  };
}

function setup(options: {
  candidates?: PublicRetrievalCandidate[];
  retrieveError?: Error;
}): {
  repository: GenerationRepositoryBoundary;
  retrieval: RetrievalBoundary;
  retrieveCalls: Array<{ ownerId: string; query: string; limit: number }>;
  createCalls: MappedGenerationResult[];
} {
  const retrieveCalls: Array<{ ownerId: string; query: string; limit: number }> = [];
  const createCalls: MappedGenerationResult[] = [];
  const repository: GenerationRepositoryBoundary = {
    findSignalByIdAndOwner: async () => makeSignal(),
    findGenerationByOwnerAndSignal: async () => null,
    createGeneration: async (_ownerId, _signalId, _source, result) => {
      createCalls.push(result);
      return makeGeneration();
    },
    updateGenerationVariation: async () => makeGeneration(),
    scheduleGenerationVariation: async () => makeGeneration(),
    clearGenerationVariationSchedule: async () => makeGeneration(),
  };
  const retrieval: RetrievalBoundary = {
    searchKnowledgeSourcesForUser: async (currentOwnerId, query, limit) => {
      retrieveCalls.push({ ownerId: currentOwnerId, query, limit });
      if (options.retrieveError) {
        throw options.retrieveError;
      }
      return options.candidates ?? [];
    },
  };
  return { repository, retrieval, retrieveCalls, createCalls };
}

test("default and explicit useKnowledge:false never call retrieval", async () => {
  const { repository, retrieval, retrieveCalls } = setup({});
  const client: AiGenerationClient = {
    generate: async (_source, context) => {
      assert.equal(context, undefined);
      return groundedResult([]);
    },
  };

  await createGenerationForSignal(ownerId, signalId, false, client, repository, retrieval);
  await createGenerationForSignal(ownerId, signalId, undefined, client, repository, retrieval);

  assert.equal(retrieveCalls.length, 0);
});

test("existing Generation is returned before retrieval or provider calls even when opted in", async () => {
  const existingRepository: GenerationRepositoryBoundary = {
    findSignalByIdAndOwner: async () => makeSignal(),
    findGenerationByOwnerAndSignal: async () => makeGeneration(),
    createGeneration: async () => {
      throw new Error("must not create");
    },
    updateGenerationVariation: async () => null,
    scheduleGenerationVariation: async () => null,
    clearGenerationVariationSchedule: async () => null,
  };
  const { retrieval, retrieveCalls } = setup({});
  const client: AiGenerationClient = {
    generate: async () => {
      throw new Error("must not call AI");
    },
  };

  const response = await createGenerationForSignal(
    ownerId,
    signalId,
    true,
    client,
    existingRepository,
    retrieval,
  );

  assert.equal(response.created, false);
  assert.equal(retrieveCalls.length, 0);
});

test("opting in derives a bounded deterministic query and requests at most 5 candidates", async () => {
  const longNotes = "n".repeat(2000);
  const repository: GenerationRepositoryBoundary = {
    findSignalByIdAndOwner: async () => makeSignal({ notes: longNotes }),
    findGenerationByOwnerAndSignal: async () => null,
    createGeneration: async () => makeGeneration(),
    updateGenerationVariation: async () => makeGeneration(),
    scheduleGenerationVariation: async () => makeGeneration(),
    clearGenerationVariationSchedule: async () => makeGeneration(),
  };
  const { retrieval, retrieveCalls } = setup({ candidates: [candidate()] });
  const client: AiGenerationClient = {
    generate: async () => groundedResult(),
  };

  await createGenerationForSignal(ownerId, signalId, true, client, repository, retrieval);

  assert.equal(retrieveCalls.length, 1);
  assert.equal(retrieveCalls[0]?.limit, 5);
  assert.ok(retrieveCalls[0]?.query.startsWith(source.topic));
  assert.ok(Array.from(retrieveCalls[0]?.query ?? "").length <= 1000);
});

test("only MongoDB-validated candidates are bounded and sent as context, honoring rank order and size", async () => {
  const big = candidate({ chunkId: "chunk-big", text: "x".repeat(3000), score: 0.5 });
  const second = candidate({ chunkId: "chunk-second", text: "y".repeat(1500), score: 0.4 });
  const { repository, retrieval } = setup({ candidates: [big, second] });
  let receivedContext: GenerationContextChunk[] | undefined;
  const client: AiGenerationClient = {
    generate: async (_source, context) => {
      receivedContext = context;
      return groundedResult(["chunk-big"]);
    },
  };

  await createGenerationForSignal(ownerId, signalId, true, client, repository, retrieval);

  assert.ok(receivedContext);
  assert.equal(receivedContext?.length, 1);
  assert.equal(receivedContext?.[0]?.chunkId, "chunk-big");
});

test("no usable knowledge context returns a specific safe error without calling generation", async () => {
  const { repository, retrieval } = setup({ candidates: [] });
  const client: AiGenerationClient = {
    generate: async () => {
      throw new Error("must not call AI");
    },
  };

  await assert.rejects(
    createGenerationForSignal(ownerId, signalId, true, client, repository, retrieval),
    { code: "GENERATION_KNOWLEDGE_UNAVAILABLE", statusCode: 422 },
  );
});

test("retrieval failures propagate safely instead of falling back to ungrounded output", async () => {
  const retrievalError = Object.assign(new Error("upstream outage"), {
    statusCode: 503,
    code: "AI_SERVICE_UNAVAILABLE",
  });
  const { repository, retrieval } = setup({ retrieveError: retrievalError });
  const client: AiGenerationClient = {
    generate: async () => {
      throw new Error("must not call AI");
    },
  };

  await assert.rejects(
    createGenerationForSignal(ownerId, signalId, true, client, repository, retrieval),
    { code: "AI_SERVICE_UNAVAILABLE" },
  );
});

test("unknown citation chunkIds are rejected safely", async () => {
  const { repository, retrieval } = setup({ candidates: [candidate()] });
  const client: AiGenerationClient = {
    generate: async () => groundedResult(["not-a-real-chunk"]),
  };

  await assert.rejects(
    createGenerationForSignal(ownerId, signalId, true, client, repository, retrieval),
    { code: "AI_INVALID_RESPONSE" },
  );
});

test("grounded variations without any citation are rejected", async () => {
  const { repository, retrieval } = setup({ candidates: [candidate()] });
  const client: AiGenerationClient = {
    generate: async () => groundedResult([]),
  };

  await assert.rejects(
    createGenerationForSignal(ownerId, signalId, true, client, repository, retrieval),
    { code: "AI_INVALID_RESPONSE" },
  );
});

test("citations are mapped to server-owned metadata and usedKnowledge is persisted", async () => {
  const { repository, retrieval, createCalls } = setup({ candidates: [candidate()] });
  const client: AiGenerationClient = {
    generate: async () => groundedResult([candidate().chunkId]),
  };

  await createGenerationForSignal(ownerId, signalId, true, client, repository, retrieval);

  assert.equal(createCalls.length, 1);
  const persisted = createCalls[0];
  assert.equal(persisted?.usedKnowledge, true);
  for (const variation of persisted?.variations ?? []) {
    assert.equal(variation.citations.length, 1);
    const citation = variation.citations[0];
    assert.deepEqual(citation, {
      sourceId: candidate().sourceId,
      title: candidate().title,
      contentVersion: candidate().contentVersion,
      chunkId: candidate().chunkId,
      startOffset: candidate().startOffset,
      endOffset: candidate().endOffset,
    });
    assert.equal(Object.keys(citation).includes("text"), false);
    assert.equal(Object.keys(citation).includes("score"), false);
  }
});

test("duplicate citation chunkIds within a variation are rejected", async () => {
  const { repository, retrieval } = setup({ candidates: [candidate()] });
  const client: AiGenerationClient = {
    generate: async () => groundedResult([candidate().chunkId, candidate().chunkId]),
  };

  await assert.rejects(
    createGenerationForSignal(ownerId, signalId, true, client, repository, retrieval),
    { code: "AI_INVALID_RESPONSE" },
  );
});

test("legacy Generations without usedKnowledge or citations normalize to ungrounded and empty", async () => {
  const legacyGeneration = {
    _id: new Types.ObjectId("507f1f77bcf86cd799439014"),
    ownerId: new Types.ObjectId(ownerId),
    signalId: new Types.ObjectId(signalId),
    source,
    model: "gpt-5-mini",
    variations: [
      {
        _id: new Types.ObjectId("507f1f77bcf86cd799439015"),
        angle: "technical_depth",
        content: "t".repeat(100),
        status: "draft",
      },
      {
        _id: new Types.ObjectId("507f1f77bcf86cd799439016"),
        angle: "learning_story",
        content: "l".repeat(100),
        status: "draft",
      },
      {
        _id: new Types.ObjectId("507f1f77bcf86cd799439017"),
        angle: "professional_impact",
        content: "p".repeat(100),
        status: "draft",
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as GenerationDocument;

  const { repository, retrieval } = setup({});
  const legacyRepository: GenerationRepositoryBoundary = {
    ...repository,
    findGenerationByOwnerAndSignal: async () => legacyGeneration,
  };
  const client: AiGenerationClient = {
    generate: async () => {
      throw new Error("must not call AI");
    },
  };

  const response = await createGenerationForSignal(
    ownerId,
    signalId,
    false,
    client,
    legacyRepository,
    retrieval,
  );

  assert.equal(response.generation.usedKnowledge, false);
  for (const variation of response.generation.variations) {
    assert.deepEqual(variation.sourceCitations, []);
  }
});
