import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import type { AiGenerationClient } from "../src/clients/ai-service.client.js";
import type { SignalDocument } from "../src/models/signal.model.js";
import type { GenerationDocument } from "../src/models/generation.model.js";
import {
  approveGenerationVariationForSignal,
  createGenerationForSignal,
  editGenerationVariationForSignal,
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
    updateGenerationVariation: async () => options.existing ?? makeGeneration(),
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

function setupVariationUpdates(
  initial: GenerationDocument | null = makeGeneration(),
): {
  repository: GenerationRepositoryBoundary;
  generation: GenerationDocument | null;
  updates: Array<{
    ownerId: string;
    signalId: string;
    variationId: string;
    update: { content?: string; status: "draft" | "approved" };
  }>;
} {
  const updates: Array<{
    ownerId: string;
    signalId: string;
    variationId: string;
    update: { content?: string; status: "draft" | "approved" };
  }> = [];
  const generation = initial;
  const base = setup({ existing: generation });
  return {
    generation,
    updates,
    repository: {
      ...base.repository,
      updateGenerationVariation: async (currentOwnerId, currentSignalId, variationId, update) => {
        updates.push({
          ownerId: currentOwnerId,
          signalId: currentSignalId,
          variationId,
          update,
        });
        if (!generation) return null;
        const variation = generation.variations.find(
          (currentVariation) => currentVariation._id.toString() === variationId,
        );
        if (!variation) return null;
        if (update.content !== undefined) variation.content = update.content;
        variation.status = update.status;
        return generation;
      },
    },
  };
}

test("editing updates only the targeted variation and preserves its identity and angle", async () => {
  const { repository, generation, updates } = setupVariationUpdates();
  assert.ok(generation);
  const target = generation.variations[1];
  const sibling = { ...generation.variations[0] };

  const response = await editGenerationVariationForSignal(
    ownerId,
    signalId,
    target._id.toString(),
    `  ${"edited content ".repeat(10)}  `,
    repository,
  );

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    ownerId,
    signalId,
    variationId: target._id.toString(),
    update: { content: "edited content ".repeat(10).trim(), status: "draft" },
  });
  assert.equal(response.variations[1].id, target._id.toString());
  assert.equal(response.variations[1].angle, "learning_story");
  assert.equal(response.variations[1].status, "draft");
  assert.equal(response.variations[0].content, sibling.content);
  assert.equal(response.variations[0].status, sibling.status);
});

test("editing approved content resets only that variation to draft", async () => {
  const generation = makeGeneration();
  generation.variations[1].status = "approved";
  const { repository } = setupVariationUpdates(generation);

  const response = await editGenerationVariationForSignal(
    ownerId,
    signalId,
    generation.variations[1]._id.toString(),
    "revised content ".repeat(10),
    repository,
  );

  assert.equal(response.variations[1].status, "draft");
  assert.equal(response.variations[0].status, "draft");
  assert.equal(response.variations[2].status, "draft");
});

test("approval changes only the targeted variation and is idempotent", async () => {
  const { repository, generation, updates } = setupVariationUpdates();
  assert.ok(generation);
  const variationId = generation.variations[2]._id.toString();

  const first = await approveGenerationVariationForSignal(
    ownerId,
    signalId,
    variationId,
    repository,
  );
  const second = await approveGenerationVariationForSignal(
    ownerId,
    signalId,
    variationId,
    repository,
  );

  assert.equal(first.variations[2].status, "approved");
  assert.equal(second.variations[2].status, "approved");
  assert.deepEqual(
    second.variations.map((variation) => variation.status),
    ["draft", "draft", "approved"],
  );
  assert.deepEqual(
    updates.map((update) => update.update),
    [{ status: "approved" }, { status: "approved" }],
  );
});

test("editing and approval reject missing owned resources without an AI operation", async () => {
  const missingSignal = setupVariationUpdates();
  missingSignal.repository.findSignalByIdAndOwner = async () => null;
  await assert.rejects(
    editGenerationVariationForSignal(
      ownerId,
      signalId,
      "507f1f77bcf86cd799439015",
      "valid content ".repeat(10),
      missingSignal.repository,
    ),
    { code: "SIGNAL_NOT_FOUND" },
  );
  assert.equal(missingSignal.updates.length, 0);

  const missingGeneration = setupVariationUpdates(null);
  await assert.rejects(
    approveGenerationVariationForSignal(
      ownerId,
      signalId,
      "507f1f77bcf86cd799439015",
      missingGeneration.repository,
    ),
    { code: "GENERATION_NOT_FOUND" },
  );

  const missingVariation = setupVariationUpdates();
  await assert.rejects(
    approveGenerationVariationForSignal(
      ownerId,
      signalId,
      "507f1f77bcf86cd799439099",
      missingVariation.repository,
    ),
    { code: "VARIATION_NOT_FOUND" },
  );
});
