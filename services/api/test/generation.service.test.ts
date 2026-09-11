import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import type { AiGenerationClient } from "../src/clients/ai-service.client.js";
import type { SignalDocument } from "../src/models/signal.model.js";
import type { GenerationDocument } from "../src/models/generation.model.js";
import {
  createGenerationForSignal,
  type GenerationRepositoryBoundary,
} from "../src/services/generation.service.js";
import type {
  AiGenerationResult,
  GenerationSource,
} from "../src/types/generation.js";

const ownerId = "507f1f77bcf86cd799439011";
const otherOwnerId = "507f1f77bcf86cd799439012";
const signalId = "507f1f77bcf86cd799439013";

const source: GenerationSource = {
  topic: "Connecting an authenticated dashboard",
  notes: "I connected the dashboard form to an authenticated Express API and verified the flow.",
  primaryAudience: "Developers & engineers",
  contentType: "Build in public",
};

const result: AiGenerationResult = {
  model: "gpt-5-mini",
  variations: [
    { angle: "professional_impact", content: "p".repeat(100) },
    { angle: "technical_depth", content: "t".repeat(100) },
    { angle: "learning_story", content: "l".repeat(100) },
  ],
};

function makeSignal(): SignalDocument {
  return {
    _id: new Types.ObjectId(signalId),
    topic: source.topic,
    notes: source.notes,
    primaryAudience: source.primaryAudience,
    contentType: source.contentType,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SignalDocument;
}

function makeGeneration(): GenerationDocument {
  return {
    _id: new Types.ObjectId("507f1f77bcf86cd799439014"),
    ownerId: new Types.ObjectId(ownerId),
    signalId: new Types.ObjectId(signalId),
    source,
    model: result.model,
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
  } as GenerationDocument;
}

function setup(
  options: {
    signal?: SignalDocument | null;
    existing?: GenerationDocument | null;
    create?: (value: {
      ownerId: string;
      signalId: string;
      source: GenerationSource;
      result: AiGenerationResult;
    }) => Promise<GenerationDocument>;
  } = {},
): {
  repository: GenerationRepositoryBoundary;
  client: AiGenerationClient;
  calls: { ai: number; creates: number };
} {
  const calls = { ai: 0, creates: 0 };
  const repository: GenerationRepositoryBoundary = {
    findSignalByIdAndOwner: async () =>
      options.signal === undefined ? makeSignal() : options.signal,
    findGenerationByOwnerAndSignal: async () => options.existing ?? null,
    createGeneration: async (currentOwnerId, currentSignalId, currentSource, currentResult) => {
      calls.creates += 1;
      if (options.create) {
        return options.create({
          ownerId: currentOwnerId,
          signalId: currentSignalId,
          source: currentSource,
          result: currentResult,
        });
      }
      return makeGeneration();
    },
  };
  const client: AiGenerationClient = {
    generate: async () => {
      calls.ai += 1;
      return result;
    },
  };
  return { repository, client, calls };
}

test("ownership failure does not call AI", async () => {
  const { repository, client, calls } = setup({ signal: null });

  await assert.rejects(
    createGenerationForSignal(ownerId, signalId, client, repository),
    { code: "SIGNAL_NOT_FOUND" },
  );
  assert.equal(calls.ai, 0);
});

test("existing Generation returns without calling AI and omits private fields", async () => {
  const { repository, client, calls } = setup({ existing: makeGeneration() });

  const response = await createGenerationForSignal(ownerId, signalId, client, repository);

  assert.equal(response.created, false);
  assert.equal(calls.ai, 0);
  assert.deepEqual(Object.keys(response.generation).sort(), [
    "createdAt",
    "id",
    "model",
    "signalId",
    "updatedAt",
    "variations",
  ]);
  assert.equal(response.generation.variations.length, 3);
});

test("valid output is persisted once in the required angle order", async () => {
  const { repository, client, calls } = setup();

  const response = await createGenerationForSignal(ownerId, signalId, client, repository);

  assert.equal(response.created, true);
  assert.equal(calls.ai, 1);
  assert.equal(calls.creates, 1);
  assert.deepEqual(
    response.generation.variations.map((variation) => variation.angle),
    ["technical_depth", "learning_story", "professional_impact"],
  );
});

test("invalid output is never persisted", async () => {
  const { repository, calls } = setup();
  const client: AiGenerationClient = {
    generate: async () => ({
      model: "gpt-5-mini",
      variations: [{ angle: "technical_depth", content: "too short" }],
    }),
  };

  await assert.rejects(
    createGenerationForSignal(ownerId, signalId, client, repository),
    { code: "AI_INVALID_RESPONSE" },
  );
  assert.equal(calls.creates, 0);
});

test("concurrent calls for one owner and Signal share one provider operation", async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { repository, calls } = setup();
  const client: AiGenerationClient = {
    generate: async () => {
      calls.ai += 1;
      await pending;
      return result;
    },
  };

  const first = createGenerationForSignal(ownerId, signalId, client, repository);
  while (calls.ai === 0) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const second = createGenerationForSignal(ownerId, signalId, client, repository);
  release?.();
  const responses = await Promise.all([first, second]);

  assert.equal(calls.ai, 1);
  assert.deepEqual(responses[0], responses[1]);
});

test("failed operations clear the in-flight guard", async () => {
  const { repository, calls } = setup();
  let shouldFail = true;
  const client: AiGenerationClient = {
    generate: async () => {
      calls.ai += 1;
      if (shouldFail) {
        shouldFail = false;
        throw new Error("provider failure");
      }
      return result;
    },
  };

  await assert.rejects(createGenerationForSignal(ownerId, signalId, client, repository));
  const response = await createGenerationForSignal(ownerId, signalId, client, repository);

  assert.equal(response.created, true);
  assert.equal(calls.ai, 2);
});

test("different owners do not share in-flight results", async () => {
  const { repository, calls } = setup();
  const client: AiGenerationClient = {
    generate: async () => {
      calls.ai += 1;
      return result;
    },
  };

  await Promise.all([
    createGenerationForSignal(ownerId, signalId, client, repository),
    createGenerationForSignal(otherOwnerId, signalId, client, repository),
  ]);

  assert.equal(calls.ai, 2);
});

test("duplicate-key races retrieve the existing owned Generation", async () => {
  let existing: GenerationDocument | null = null;
  const persisted = makeGeneration();
  const { repository, client } = setup({
    create: async () => {
      existing = persisted;
      const error = new Error("duplicate");
      Object.assign(error, { code: 11000 });
      throw error;
    },
  });
  const raceRepository: GenerationRepositoryBoundary = {
    ...repository,
    findGenerationByOwnerAndSignal: async () => existing,
  };

  const response = await createGenerationForSignal(ownerId, signalId, client, raceRepository);

  assert.equal(response.created, false);
  assert.equal(response.generation.id, persisted._id.toString());
});
