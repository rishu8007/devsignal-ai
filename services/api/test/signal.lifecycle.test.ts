import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import { updateSignalSchema } from "../src/validation/signal.validation.js";
import { updateSignalForUser, type SignalMutationRepository } from "../src/services/signal.service.js";
import {
  createGenerationForSignal,
  type GenerationRepositoryBoundary,
} from "../src/services/generation.service.js";
import type { SignalDocument } from "../src/models/signal.model.js";
import type { GenerationDocument } from "../src/models/generation.model.js";
import type { AiGenerationClient } from "../src/clients/ai-service.client.js";

const owner = "507f1f77bcf86cd799439011";
const otherOwner = "507f1f77bcf86cd799439012";
const signalId = "507f1f77bcf86cd799439013";
const now = new Date("2030-01-01T00:00:00.000Z");

function signal(overrides: Partial<SignalDocument> = {}): SignalDocument {
  return {
    _id: new Types.ObjectId(signalId),
    topic: "A valid Signal topic",
    notes: "These are sufficiently long Signal notes for lifecycle tests.",
    primaryAudience: "Developers & engineers",
    contentType: "Technical insight",
    revision: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as SignalDocument;
}

const update = {
  topic: "An edited Signal topic",
  notes: "These are sufficiently long edited Signal notes for lifecycle tests.",
  primaryAudience: "Developers & engineers" as const,
  contentType: "Technical insight" as const,
  expectedRevision: 2,
};

test("Signal PATCH validation is strict and expectedRevision is positive", () => {
  assert.equal(updateSignalSchema.safeParse(update).success, true);
  assert.equal(updateSignalSchema.safeParse({ ...update, unknown: true }).success, false);
  assert.equal(updateSignalSchema.safeParse({ ...update, expectedRevision: 0 }).success, false);
});

test("Signal edits preserve owner isolation and distinguish stale revisions", async () => {
  const repository: SignalMutationRepository = {
    findSignalByIdAndOwner: async (currentOwner) => currentOwner === owner ? signal() : null,
    findGenerationByOwnerAndSignal: async () => null,
    updateSignalIfEditable: async (_owner, _id, input) =>
      input.expectedRevision === 2 ? signal({ ...update, revision: 3 }) : null,
  };

  await assert.rejects(updateSignalForUser(otherOwner, signalId, update, now, repository), {
    code: "SIGNAL_NOT_FOUND",
  });
  await assert.rejects(
    updateSignalForUser(owner, signalId, { ...update, expectedRevision: 1 }, now, repository),
    { code: "SIGNAL_VERSION_CONFLICT" },
  );
});

test("existing Generations block edits, including legacy Signals", async () => {
  const legacy = signal({ revision: undefined });
  const repository: SignalMutationRepository = {
    findSignalByIdAndOwner: async () => legacy,
    findGenerationByOwnerAndSignal: async () => ({ _id: new Types.ObjectId() } as GenerationDocument),
    updateSignalIfEditable: async () => {
      throw new Error("must not update");
    },
  };
  await assert.rejects(updateSignalForUser(owner, signalId, update, now, repository), {
    code: "SIGNAL_GENERATION_EXISTS",
  });
});

function generationFixture(): GenerationDocument {
  return {
    _id: new Types.ObjectId("507f1f77bcf86cd799439014"),
    ownerId: new Types.ObjectId(owner),
    signalId: new Types.ObjectId(signalId),
    source: {
      topic: "A valid Signal topic",
      notes: "These are sufficiently long Signal notes for lifecycle tests.",
      primaryAudience: "Developers & engineers",
      contentType: "Technical insight",
    },
    model: "test",
    usedKnowledge: false,
    variations: [
      { _id: new Types.ObjectId(), angle: "technical_depth", content: "x".repeat(100), status: "draft", citations: [] },
      { _id: new Types.ObjectId(), angle: "learning_story", content: "x".repeat(100), status: "draft", citations: [] },
      { _id: new Types.ObjectId(), angle: "professional_impact", content: "x".repeat(100), status: "draft", citations: [] },
    ],
    createdAt: now,
    updatedAt: now,
  } as GenerationDocument;
}

function generationSetup(options: {
  reserved?: SignalDocument | null;
  active?: boolean | (() => boolean);
  create?: () => Promise<GenerationDocument>;
  mark?: () => Promise<SignalDocument | null>;
}) {
  let releases = 0;
  const initial = signal({ revision: 1, topic: "Initial Signal topic" });
  const repository: GenerationRepositoryBoundary = {
    findSignalByIdAndOwner: async () => initial,
    findGenerationByOwnerAndSignal: async () => null,
    reserveSignalForGeneration: async () => options.reserved === undefined ? signal() : options.reserved,
    beginSignalGenerationPersistence: async () =>
      (typeof options.active === "function" ? options.active() : options.active !== false)
        ? signal({ generationLeaseState: "persisting", generationLeaseExpiresAt: undefined })
        : null,
    hasActiveSignalGenerationLease: async () =>
      typeof options.active === "function" ? options.active() : options.active !== false,
    releaseSignalGenerationLease: async () => {
      releases += 1;
      return signal();
    },
    markSignalGeneration: options.mark ?? (async () => signal()),
    createGeneration: options.create ?? (async () => generationFixture()),
    updateGenerationVariation: async () => generationFixture(),
    scheduleGenerationVariation: async () => generationFixture(),
    clearGenerationVariationSchedule: async () => generationFixture(),
  };
  const client: AiGenerationClient = {
    generate: async (source) => ({
      model: "test",
      variations: [
        { angle: "technical_depth", content: "x".repeat(100), citations: [] },
        { angle: "learning_story", content: "x".repeat(100), citations: [] },
        { angle: "professional_impact", content: "x".repeat(100), citations: [] },
      ],
    }),
  };
  return { repository, client, get releases() { return releases; } };
}

test("generation uses the atomically reserved Signal snapshot", async () => {
  const reserved = signal({ revision: 3, topic: "Reserved Signal topic" });
  const setup = generationSetup({ reserved });
  let persistedTopic = "";
  setup.repository.createGeneration = async (_owner, _id, source) => {
    persistedTopic = source.topic;
    return generationFixture();
  };
  await createGenerationForSignal(owner, signalId, false, setup.client, setup.repository, undefined, () => now);
  assert.equal(persistedTopic, "Reserved Signal topic");
});

test("expired reservations cannot persist an old attempt and stale cleanup is lease-scoped", async () => {
  const setup = generationSetup({ active: false });
  let creates = 0;
  setup.repository.createGeneration = async () => {
    creates += 1;
    return generationFixture();
  };
  await assert.rejects(
    createGenerationForSignal(owner, signalId, false, setup.client, setup.repository, undefined, () => now),
    { code: "SIGNAL_GENERATION_IN_PROGRESS" },
  );
  assert.equal(creates, 0);
  assert.equal(setup.releases, 1);

  const staleRelease = setup.repository.releaseSignalGenerationLease;
  assert.ok(staleRelease);
  await staleRelease(otherOwner, signalId, "stale-lease");
  assert.equal(setup.releases, 2);
});

test("provider work that exceeds the lease cannot persist the old attempt", async () => {
  let current = now;
  const setup = generationSetup({ active: () => current.getTime() < now.getTime() + 240_000 });
  let creates = 0;
  setup.client.generate = async () => {
    current = new Date(now.getTime() + 240_001);
    return {
      model: "test",
      variations: [
        { angle: "technical_depth", content: "x".repeat(100), citations: [] },
        { angle: "learning_story", content: "x".repeat(100), citations: [] },
        { angle: "professional_impact", content: "x".repeat(100), citations: [] },
      ],
    };
  };
  setup.repository.createGeneration = async () => {
    creates += 1;
    return generationFixture();
  };
  await assert.rejects(
    createGenerationForSignal(owner, signalId, false, setup.client, setup.repository, undefined, () => current),
    { code: "SIGNAL_GENERATION_IN_PROGRESS" },
  );
  assert.equal(creates, 0);
});

test("ambiguous Generation writes do not release protection", async () => {
  const setup = generationSetup({});
  setup.repository.createGeneration = async () => {
    throw new Error("network timeout after write may have committed");
  };
  await assert.rejects(
    createGenerationForSignal(owner, signalId, false, setup.client, setup.repository, undefined, () => now),
    { code: "GENERATION_PERSISTENCE_UNCERTAIN" },
  );
  assert.equal(setup.releases, 0);
});

test("a successful insert with failed Signal marking keeps the Generation protection path", async () => {
  const setup = generationSetup({
    mark: async () => null,
  });
  const response = await createGenerationForSignal(owner, signalId, false, setup.client, setup.repository, undefined, () => now);
  assert.equal(response.created, true);
  assert.equal(setup.releases, 0);
});
