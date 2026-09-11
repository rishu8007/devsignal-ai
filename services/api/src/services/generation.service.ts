import { Types } from "mongoose";
import { aiServiceClient, type AiGenerationClient } from "../clients/ai-service.client.js";
import { AppError } from "../errors/app-error.js";
import type { GenerationDocument } from "../models/generation.model.js";
import {
  createGeneration,
  findGenerationByOwnerAndSignal,
  updateGenerationVariation,
} from "../repositories/generation.repository.js";
import { findSignalByIdAndOwner } from "../repositories/signal.repository.js";
import { GENERATION_ANGLES } from "../types/generation.js";
import type {
  AiGenerationResult,
  GenerationSource,
  PublicGenerationDto,
} from "../types/generation.js";

// This guard is process-local; distributed coordination is deferred to a later milestone.
const inFlight = new Map<string, Promise<GenerationOperationResult>>();

export interface GenerationRepositoryBoundary {
  findGenerationByOwnerAndSignal: typeof findGenerationByOwnerAndSignal;
  createGeneration: typeof createGeneration;
  findSignalByIdAndOwner: typeof findSignalByIdAndOwner;
  updateGenerationVariation: typeof updateGenerationVariation;
}

const defaultRepository: GenerationRepositoryBoundary = {
  findGenerationByOwnerAndSignal,
  createGeneration,
  findSignalByIdAndOwner,
  updateGenerationVariation,
};

export interface GenerationOperationResult {
  generation: PublicGenerationDto;
  created: boolean;
}

export async function createGenerationForSignal(
  ownerId: string,
  signalId: string,
  aiClient: AiGenerationClient = aiServiceClient,
  repository: GenerationRepositoryBoundary = defaultRepository,
): Promise<GenerationOperationResult> {
  const signal = await findSignalByOwner(ownerId, signalId, repository);
  const existing = await repository.findGenerationByOwnerAndSignal(ownerId, signalId);
  if (existing) {
    return { generation: toPublicGenerationDto(existing), created: false };
  }

  const key = `${ownerId}:${signalId}`;
  const current = inFlight.get(key);
  if (current) {
    return current;
  }

  const operation = generateAndPersist(ownerId, signalId, signal, aiClient, repository);
  inFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(key) === operation) {
      inFlight.delete(key);
    }
  }
}

export async function getGenerationForSignal(
  ownerId: string,
  signalId: string,
  repository: GenerationRepositoryBoundary = defaultRepository,
): Promise<PublicGenerationDto> {
  await findSignalByOwner(ownerId, signalId, repository);
  const generation = await repository.findGenerationByOwnerAndSignal(ownerId, signalId);
  if (!generation) {
    throw new AppError(404, "GENERATION_NOT_FOUND", "No generation exists for this signal");
  }
  return toPublicGenerationDto(generation);
}

export async function editGenerationVariationForSignal(
  ownerId: string,
  signalId: string,
  variationId: string,
  content: string,
  repository: GenerationRepositoryBoundary = defaultRepository,
): Promise<PublicGenerationDto> {
  await findSignalByOwner(ownerId, signalId, repository);
  const generation = await repository.updateGenerationVariation(
    ownerId,
    signalId,
    variationId,
    { content: content.trim(), status: "draft" },
  );
  return requireUpdatedVariation(generation, repository, ownerId, signalId);
}

export async function approveGenerationVariationForSignal(
  ownerId: string,
  signalId: string,
  variationId: string,
  repository: GenerationRepositoryBoundary = defaultRepository,
): Promise<PublicGenerationDto> {
  await findSignalByOwner(ownerId, signalId, repository);
  const generation = await repository.updateGenerationVariation(
    ownerId,
    signalId,
    variationId,
    { status: "approved" },
  );
  return requireUpdatedVariation(generation, repository, ownerId, signalId);
}

async function findSignalByOwner(
  ownerId: string,
  signalId: string,
  repository: GenerationRepositoryBoundary,
) {
  if (!Types.ObjectId.isValid(signalId)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid request data");
  }
  const signal = await repository.findSignalByIdAndOwner(ownerId, signalId);
  if (!signal) {
    throw new AppError(404, "SIGNAL_NOT_FOUND", "Signal not found");
  }
  return signal;
}

async function generateAndPersist(
  ownerId: string,
  signalId: string,
  signal: Awaited<ReturnType<typeof findSignalByOwner>>,
  aiClient: AiGenerationClient,
  repository: GenerationRepositoryBoundary,
): Promise<GenerationOperationResult> {
  const source: GenerationSource = {
    topic: signal.topic,
    notes: signal.notes,
    primaryAudience: signal.primaryAudience,
    contentType: signal.contentType,
  };
  const result = normalizeAiGenerationResult(await aiClient.generate(source));

  try {
    const generation = await repository.createGeneration(ownerId, signalId, source, result);
    return { generation: toPublicGenerationDto(generation), created: true };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await repository.findGenerationByOwnerAndSignal(ownerId, signalId);
      if (existing) {
        return { generation: toPublicGenerationDto(existing), created: false };
      }
    }
    throw error;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

async function requireUpdatedVariation(
  generation: GenerationDocument | null,
  repository: GenerationRepositoryBoundary,
  ownerId: string,
  signalId: string,
): Promise<PublicGenerationDto> {
  if (!generation) {
    const existing = await repository.findGenerationByOwnerAndSignal(ownerId, signalId);
    if (!existing) {
      throw new AppError(404, "GENERATION_NOT_FOUND", "No generation exists for this signal");
    }
    throw new AppError(404, "VARIATION_NOT_FOUND", "Generation variation not found");
  }
  return toPublicGenerationDto(generation);
}

function normalizeAiGenerationResult(result: AiGenerationResult): AiGenerationResult {
  const model = result.model.trim();
  if (!model || result.variations.length !== GENERATION_ANGLES.length) {
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
  }

  const byAngle = new Map<
    (typeof GENERATION_ANGLES)[number],
    (typeof result.variations)[number]
  >();
  for (const variation of result.variations) {
    const content = variation.content.trim();
    if (!content || content.length < 100 || content.length > 3000 || byAngle.has(variation.angle)) {
      throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
    }
    byAngle.set(variation.angle, { ...variation, content });
  }

  if (byAngle.size !== GENERATION_ANGLES.length) {
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
  }

  return {
    model,
    variations: GENERATION_ANGLES.map((angle) => {
      const variation = byAngle.get(angle);
      if (!variation) {
        throw new AppError(
          502,
          "AI_INVALID_RESPONSE",
          "The AI provider returned an invalid response",
        );
      }
      return variation;
    }),
  };
}

function toPublicGenerationDto(generation: GenerationDocument): PublicGenerationDto {
  return {
    id: generation._id.toString(),
    signalId: generation.signalId.toString(),
    model: generation.model,
    variations: generation.variations.map((variation) => ({
      id: variation._id.toString(),
      angle: variation.angle,
      content: variation.content,
      status: variation.status,
    })),
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt,
  };
}
