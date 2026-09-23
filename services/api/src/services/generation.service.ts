import { Types } from "mongoose";
import { randomUUID } from "node:crypto";
import { aiServiceClient, type AiGenerationClient } from "../clients/ai-service.client.js";
import { AppError } from "../errors/app-error.js";
import type { GenerationDocument } from "../models/generation.model.js";
import {
  createGeneration,
  findGenerationByOwnerAndSignal,
  updateGenerationVariation,
  scheduleGenerationVariation,
  clearGenerationVariationSchedule,
} from "../repositories/generation.repository.js";
import {
  findSignalByIdAndOwner,
  markSignalGeneration,
  releaseSignalGenerationLease,
  reserveSignalForGeneration,
  hasActiveSignalGenerationLease,
  beginSignalGenerationPersistence,
  reconcileSignalGeneration,
} from "../repositories/signal.repository.js";
import {
  searchKnowledgeSourcesForUser,
  type PublicRetrievalCandidate,
} from "./knowledge-source-retrieval.service.js";
import { GENERATION_ANGLES } from "../types/generation.js";
import type {
  AiGenerationResult,
  GenerationContextChunk,
  GenerationSource,
  MappedGenerationResult,
  MappedGenerationVariation,
  PublicGenerationDto,
  PublicSourceCitation,
} from "../types/generation.js";
import { admitAiOperation, completeAiOperation, markAiDispatched, markAiUncertain, releaseAiOperation } from "./usage.service.js";

// This guard is process-local; distributed coordination is deferred to a later milestone.
const inFlight = new Map<string, Promise<GenerationOperationResult>>();

// Mirrors the AI service's own context bounds so requests never get rejected by the
// downstream contract; also matches the /sources/search default candidate ceiling.
const MAX_KNOWLEDGE_CANDIDATES = 5;
// Matches the AI service's MAX_CONTEXT_TOTAL_LENGTH defense-in-depth bound.
const MAX_CONTEXT_TOTAL_CODE_POINTS = 4000;
// Matches the retrieval endpoint's own query length ceiling (retrieval.validation.ts).
const MAX_KNOWLEDGE_QUERY_CODE_POINTS = 1000;

export interface RetrievalBoundary {
  searchKnowledgeSourcesForUser: typeof searchKnowledgeSourcesForUser;
}

const defaultRetrievalBoundary: RetrievalBoundary = { searchKnowledgeSourcesForUser };

export interface GenerationRepositoryBoundary {
  findGenerationByOwnerAndSignal: typeof findGenerationByOwnerAndSignal;
  createGeneration: typeof createGeneration;
  findSignalByIdAndOwner: typeof findSignalByIdAndOwner;
  updateGenerationVariation: typeof updateGenerationVariation;
  scheduleGenerationVariation: typeof scheduleGenerationVariation;
  clearGenerationVariationSchedule: typeof clearGenerationVariationSchedule;
  reserveSignalForGeneration?: typeof reserveSignalForGeneration;
  markSignalGeneration?: typeof markSignalGeneration;
  releaseSignalGenerationLease?: typeof releaseSignalGenerationLease;
  hasActiveSignalGenerationLease?: typeof hasActiveSignalGenerationLease;
  beginSignalGenerationPersistence?: typeof beginSignalGenerationPersistence;
  reconcileSignalGeneration?: typeof reconcileSignalGeneration;
}

const defaultRepository: GenerationRepositoryBoundary = {
  findGenerationByOwnerAndSignal,
  createGeneration,
  findSignalByIdAndOwner,
  updateGenerationVariation,
  scheduleGenerationVariation,
  clearGenerationVariationSchedule,
  reserveSignalForGeneration,
  markSignalGeneration,
  releaseSignalGenerationLease,
  hasActiveSignalGenerationLease,
  beginSignalGenerationPersistence,
  reconcileSignalGeneration,
};

export interface GenerationOperationResult {
  generation: PublicGenerationDto;
  created: boolean;
}

export async function createGenerationForSignal(
  ownerId: string,
  signalId: string,
  useKnowledge = false,
  aiClient: AiGenerationClient = aiServiceClient,
  repository: GenerationRepositoryBoundary = defaultRepository,
  retrieval: RetrievalBoundary = defaultRetrievalBoundary,
  clock: () => Date = () => new Date(),
): Promise<GenerationOperationResult> {
  const signal = await findSignalByOwner(ownerId, signalId, repository);
  // The existing-Generation check always happens before any retrieval or provider call,
  // regardless of useKnowledge, so an already-generated Signal never triggers new
  // retrieval or paid AI calls.
  const existing = await repository.findGenerationByOwnerAndSignal(ownerId, signalId);
  if (existing) {
    await reconcileSignalProtection(ownerId, signalId, null, existing, repository);
    return { generation: toPublicGenerationDto(existing), created: false };
  }

  const key = `${ownerId}:${signalId}`;
  const current = inFlight.get(key);
  if (current) {
    return current;
  }

  const leaseId = randomUUID();
  const reservedSignal = repository.reserveSignalForGeneration
    ? await repository.reserveSignalForGeneration(
        ownerId,
        signalId,
        leaseId,
        new Date(clock().getTime() + 240_000),
      )
    : signal;
  if (!reservedSignal) {
    const concurrentGeneration = await repository.findGenerationByOwnerAndSignal(ownerId, signalId);
    if (concurrentGeneration) {
      await reconcileSignalProtection(ownerId, signalId, null, concurrentGeneration, repository);
      return { generation: toPublicGenerationDto(concurrentGeneration), created: false };
    }
    throw new AppError(
      409,
      "SIGNAL_GENERATION_IN_PROGRESS",
      "This Signal is currently being used to generate drafts",
    );
  }

  const operation = generateAndPersist(
    ownerId,
    signalId,
    reservedSignal,
    useKnowledge,
    aiClient,
    repository,
    retrieval,
    repository.reserveSignalForGeneration ? leaseId : null,
    clock,
  );
  inFlight.set(key, operation);
  let generationCommitted = false;
  let operationError: unknown;
  try {
    const result = await operation;
    generationCommitted = true;
    return result;
  } catch (error: unknown) {
    operationError = error;
    throw error;
  } finally {
    if (
      !generationCommitted &&
      !(operationError instanceof UncertainGenerationWriteError) &&
      repository.releaseSignalGenerationLease &&
      repository.reserveSignalForGeneration
    ) {
      await repository.releaseSignalGenerationLease(ownerId, signalId, leaseId);
    }
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
  // Edited text is no longer checked against the citations that were validated for the
  // previous content, so citations are cleared alongside the existing approval/schedule
  // reset.
  const generation = await repository.updateGenerationVariation(
    ownerId,
    signalId,
    variationId,
    { content: content.trim(), status: "draft", scheduledFor: null, citations: [] },
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

export async function scheduleGenerationVariationForSignal(
  ownerId: string,
  signalId: string,
  variationId: string,
  scheduledFor: Date,
  repository: GenerationRepositoryBoundary = defaultRepository,
  now = new Date(),
): Promise<PublicGenerationDto> {
  await findSignalByOwner(ownerId, signalId, repository);
  if (scheduledFor <= now) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid request data");
  }
  const generation = await repository.scheduleGenerationVariation(
    ownerId,
    signalId,
    variationId,
    scheduledFor,
  );
  if (generation) {
    return toPublicGenerationDto(generation);
  }
  const existing = await repository.findGenerationByOwnerAndSignal(ownerId, signalId);
  if (!existing) {
    throw new AppError(404, "GENERATION_NOT_FOUND", "No generation exists for this signal");
  }
  const variation = existing.variations.find((item) => item._id.toString() === variationId);
  if (!variation) {
    throw new AppError(404, "VARIATION_NOT_FOUND", "Generation variation not found");
  }
  throw new AppError(409, "VARIATION_NOT_APPROVED", "Generation variation must be approved");
}

export async function clearGenerationVariationScheduleForSignal(
  ownerId: string,
  signalId: string,
  variationId: string,
  repository: GenerationRepositoryBoundary = defaultRepository,
): Promise<PublicGenerationDto> {
  await findSignalByOwner(ownerId, signalId, repository);
  return requireUpdatedVariation(
    await repository.clearGenerationVariationSchedule(ownerId, signalId, variationId),
    repository,
    ownerId,
    signalId,
  );
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
  useKnowledge: boolean,
  aiClient: AiGenerationClient,
  repository: GenerationRepositoryBoundary,
  retrieval: RetrievalBoundary,
  leaseId: string | null,
  clock: () => Date,
): Promise<GenerationOperationResult> {
  const source: GenerationSource = {
    topic: signal.topic,
    notes: signal.notes,
    primaryAudience: signal.primaryAudience,
    contentType: signal.contentType,
  };

  let contextChunks: GenerationContextChunk[] | undefined;
  let candidatesByChunkId = new Map<string, PublicRetrievalCandidate>();
  if (useKnowledge) {
    const query = buildKnowledgeQuery(signal);
    // A propagated retrieval failure (e.g. AI service outage) surfaces as-is; it is
    // never silently swallowed into an ungrounded generation.
    const candidates = query
      ? await retrieval.searchKnowledgeSourcesForUser(ownerId, query, MAX_KNOWLEDGE_CANDIDATES)
      : [];
    const bounded = boundContext(candidates);
    if (bounded.length === 0) {
      throw new AppError(
        422,
        "GENERATION_KNOWLEDGE_UNAVAILABLE",
        "No usable knowledge context is available for this Signal",
      );
    }
    candidatesByChunkId = new Map(bounded.map((candidate) => [candidate.chunkId, candidate]));
    contextChunks = bounded.map((candidate) => ({
      chunkId: candidate.chunkId,
      text: candidate.text,
    }));
  }

  const trackUsage = repository === defaultRepository;
  const admission = trackUsage ? await admitAiOperation(ownerId, `generation:${signalId}`, "generation", clock()) : null;
  if (admission?.duplicate) {
    throw new AppError(409, "AI_OPERATION_IN_PROGRESS", "This AI operation is already in progress");
  }
  if (admission) await markAiDispatched(admission.id);
  let rawResult: AiGenerationResult;
  try {
    rawResult = await aiClient.generate(source, contextChunks);
  } catch (error) {
    if (error instanceof AppError && [504, 502].includes(error.statusCode)) {
      if (admission) await markAiUncertain(admission.id);
    } else {
      if (admission) await releaseAiOperation(admission.id);
    }
    throw error;
  }
  if (admission) await completeAiOperation(admission.id, { model: rawResult.model, ...rawResult.usage });
  const result = normalizeAiGenerationResult(rawResult, useKnowledge, candidatesByChunkId);

  if (leaseId && repository.beginSignalGenerationPersistence) {
    const persisting = await repository.beginSignalGenerationPersistence(
      ownerId,
      signalId,
      signal.revision ?? 1,
      leaseId,
      clock(),
    );
    if (!persisting) {
      throw new AppError(
        409,
        "SIGNAL_GENERATION_IN_PROGRESS",
        "The generation reservation expired or was superseded before drafts could be saved",
      );
    }
  } else if (
    leaseId &&
    repository.hasActiveSignalGenerationLease &&
    !(await repository.hasActiveSignalGenerationLease(ownerId, signalId, leaseId, clock()))
  ) {
    throw new AppError(
      409,
      "SIGNAL_GENERATION_IN_PROGRESS",
      "The generation reservation expired before drafts could be saved",
    );
  }

  try {
    const generation = await repository.createGeneration(ownerId, signalId, source, result);
    if (leaseId && repository.markSignalGeneration) {
      const marked = await repository.markSignalGeneration(
        ownerId,
        signalId,
        leaseId,
        generation._id.toString(),
      );
      if (!marked) {
        // Keep the lease when the marker cannot be written: the Generation now
        // exists, so the edit path remains blocked by its existence check.
        return { generation: toPublicGenerationDto(generation), created: true };
      }
    }
    return { generation: toPublicGenerationDto(generation), created: true };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await repository.findGenerationByOwnerAndSignal(ownerId, signalId);
      if (existing) {
        await reconcileSignalProtection(ownerId, signalId, leaseId, existing, repository);
        return { generation: toPublicGenerationDto(existing), created: false };
      }
    }
    const existing = await repository.findGenerationByOwnerAndSignal(ownerId, signalId);
    if (existing) {
      await reconcileSignalProtection(ownerId, signalId, leaseId, existing, repository);
      return { generation: toPublicGenerationDto(existing), created: false };
    }
    throw new UncertainGenerationWriteError(error);
  }
}

async function reconcileSignalProtection(
  ownerId: string,
  signalId: string,
  leaseId: string | null,
  generation: GenerationDocument,
  repository: GenerationRepositoryBoundary,
): Promise<void> {
  if (leaseId && repository.markSignalGeneration) {
    await repository.markSignalGeneration(ownerId, signalId, leaseId, generation._id.toString());
  } else if (repository.reconcileSignalGeneration) {
    await repository.reconcileSignalGeneration(ownerId, signalId, generation._id.toString());
  }
}

class UncertainGenerationWriteError extends AppError {
  constructor(cause: unknown) {
    super(
      409,
      "GENERATION_PERSISTENCE_UNCERTAIN",
      "Generation persistence is unresolved; retry status reconciliation before editing this Signal",
    );
    this.name = "UncertainGenerationWriteError";
    void cause;
  }
}

// Combines the Signal's own topic and notes into a single deterministic retrieval
// query: same Signal always produces the same query, with no client input involved.
// Truncated using Unicode code points (not JS UTF-16 code units) to stay within the
// retrieval endpoint's own query length ceiling without splitting a surrogate pair.
function buildKnowledgeQuery(signal: Awaited<ReturnType<typeof findSignalByOwner>>): string {
  const combined = `${signal.topic}\n${signal.notes}`.trim();
  const codePoints = Array.from(combined);
  return codePoints.slice(0, MAX_KNOWLEDGE_QUERY_CODE_POINTS).join("");
}

// Deduplicates exact text after line-ending normalization, preserving the first
// ranked candidate and its citation metadata. Separate source records may still
// legitimately expose the same text through the public search endpoint; this
// selection-only deduplication applies only to context sent to generation.
//
// Bounds are applied after deduplication, in the rank order returned by retrieval.
// Stops (rather than skipping) once the next candidate would exceed the budget, so
// the context sent to the AI service always respects its bounded-context contract.
function boundContext(candidates: PublicRetrievalCandidate[]): PublicRetrievalCandidate[] {
  const bounded: PublicRetrievalCandidate[] = [];
  const seenTexts = new Set<string>();
  let totalCodePoints = 0;
  const uniqueCandidates: PublicRetrievalCandidate[] = [];
  for (const candidate of candidates) {
    const normalizedText = normalizeLineEndings(candidate.text);
    if (seenTexts.has(normalizedText)) {
      continue;
    }
    seenTexts.add(normalizedText);
    uniqueCandidates.push(candidate);
  }

  for (const candidate of uniqueCandidates.slice(0, MAX_KNOWLEDGE_CANDIDATES)) {
    const candidateLength = Array.from(candidate.text).length;
    if (totalCodePoints + candidateLength > MAX_CONTEXT_TOTAL_CODE_POINTS) {
      break;
    }
    bounded.push(candidate);
    totalCodePoints += candidateLength;
  }
  return bounded;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

export function normalizeAiGenerationResult(
  result: AiGenerationResult,
  useKnowledge: boolean,
  candidatesByChunkId: Map<string, PublicRetrievalCandidate>,
): MappedGenerationResult {
  const model = result.model.trim();
  if (!model || result.variations.length !== GENERATION_ANGLES.length) {
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
  }

  const byAngle = new Map<(typeof GENERATION_ANGLES)[number], MappedGenerationVariation>();
  for (const variation of result.variations) {
    const content = variation.content.trim();
    if (!content || content.length < 100 || content.length > 3000 || byAngle.has(variation.angle)) {
      throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
    }

    // Reject unknown citation IDs safely rather than silently dropping them: an
    // unrecognized chunkId means the model referenced something outside the supplied
    // context, which is a contract violation, not a partial success.
    const seenChunkIds = new Set<string>();
    const citations: PublicSourceCitation[] = [];
    for (const chunkId of variation.citations) {
      if (seenChunkIds.has(chunkId)) {
        throw new AppError(
          502,
          "AI_INVALID_RESPONSE",
          "The AI provider returned an invalid response",
        );
      }
      seenChunkIds.add(chunkId);
      const candidate = candidatesByChunkId.get(chunkId);
      if (!candidate) {
        throw new AppError(
          502,
          "AI_INVALID_RESPONSE",
          "The AI provider returned an invalid response",
        );
      }
      citations.push({
        sourceId: candidate.sourceId,
        title: candidate.title,
        contentVersion: candidate.contentVersion,
        chunkId: candidate.chunkId,
        startOffset: candidate.startOffset,
        endOffset: candidate.endOffset,
      });
    }

    if (useKnowledge && citations.length === 0) {
      throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
    }

    byAngle.set(variation.angle, { angle: variation.angle, content, citations });
  }

  if (byAngle.size !== GENERATION_ANGLES.length) {
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
  }

  return {
    model,
    usedKnowledge: useKnowledge,
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

// Score reflects vector similarity at retrieval time, not factual confidence, and the
// MongoDB validation performed during retrieval is only a point-in-time check; the
// underlying source may change or be removed after a Generation is created.
function toPublicGenerationDto(generation: GenerationDocument): PublicGenerationDto {
  return {
    id: generation._id.toString(),
    signalId: generation.signalId.toString(),
    model: generation.model,
    usedKnowledge: generation.usedKnowledge ?? false,
    variations: generation.variations.map((variation) => ({
      id: variation._id.toString(),
      angle: variation.angle,
      content: variation.content,
      status: variation.status,
      scheduledFor: variation.scheduledFor ?? null,
      sourceCitations: (variation.citations ?? []).map((citation) => ({
        sourceId: citation.sourceId.toString(),
        title: citation.title,
        contentVersion: citation.contentVersion,
        chunkId: citation.chunkId,
        startOffset: citation.startOffset,
        endOffset: citation.endOffset,
      })),
    })),
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt,
  };
}
