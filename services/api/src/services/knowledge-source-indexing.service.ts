import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  claimKnowledgeSourceIndexing,
  finalizeKnowledgeSourceIndexing,
  findKnowledgeSourceForIndexing,
  type KnowledgeSourceIndexingMetadata,
} from "../repositories/knowledge-source.repository.js";
import type { PublicKnowledgeSourceDto } from "./knowledge-source.service.js";
import { aiIndexingClient, type AiIndexingClient } from "../clients/indexing.client.js";

const INDEXING_LEASE_MS = Math.max(env.AI_SERVICE_TIMEOUT_MS + 30_000, 180_000);

export interface IndexingRepository {
  findKnowledgeSourceForIndexing: typeof findKnowledgeSourceForIndexing;
  claimKnowledgeSourceIndexing: typeof claimKnowledgeSourceIndexing;
  finalizeKnowledgeSourceIndexing: typeof finalizeKnowledgeSourceIndexing;
}

export type IndexingClock = () => Date;

const defaultRepository: IndexingRepository = {
  findKnowledgeSourceForIndexing,
  claimKnowledgeSourceIndexing,
  finalizeKnowledgeSourceIndexing,
};

function sourceNotFound(): AppError {
  return new AppError(404, "SOURCE_NOT_FOUND", "Knowledge source not found");
}

function toPublicSource(source: Awaited<ReturnType<typeof findKnowledgeSourceForIndexing>>): PublicKnowledgeSourceDto {
  if (!source) {
    throw sourceNotFound();
  }
  return {
    id: source._id.toString(),
    title: source.title,
    content: source.content,
    contentVersion: source.contentVersion,
    processingStatus: source.processingStatus,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

export async function indexKnowledgeSourceForUser(
  ownerId: string,
  sourceId: string,
  client: AiIndexingClient = aiIndexingClient,
  repository: IndexingRepository = defaultRepository,
  now: IndexingClock = () => new Date(),
): Promise<PublicKnowledgeSourceDto> {
  const startTime = Date.now();
  const correlationId = sourceId.substring(0, 8);

  if (!Types.ObjectId.isValid(ownerId) || !Types.ObjectId.isValid(sourceId)) {
    console.log(`[indexing] ${correlationId} source-not-found`);
    throw sourceNotFound();
  }
  const current = await repository.findKnowledgeSourceForIndexing(ownerId, sourceId);
  if (!current) {
    console.log(`[indexing] ${correlationId} source-not-found`);
    throw sourceNotFound();
  }
  if (
    current.processingStatus === "indexed" &&
    current.indexedContentVersion === current.contentVersion &&
    current.indexedChunkerVersion &&
    current.indexedEmbeddingModel &&
    current.indexedDimensions &&
    current.indexedChunkCount
  ) {
    console.log(`[indexing] ${correlationId} already-indexed version=${current.contentVersion}`);
    return toPublicSource(current);
  }
  if (
    current.processingStatus === "indexing" &&
    (current.indexingLeaseExpiresAt ?? new Date(0)) > now()
  ) {
    console.log(`[indexing] ${correlationId} indexing-in-progress`);
    throw new AppError(409, "SOURCE_INDEXING_IN_PROGRESS", "Knowledge source indexing is in progress");
  }

  const attemptId = randomUUID();
  const claimed = await repository.claimKnowledgeSourceIndexing(
    ownerId,
    sourceId,
    current.contentVersion,
    attemptId,
    new Date(now().getTime() + INDEXING_LEASE_MS),
  );
  if (!claimed) {
    const latest = await repository.findKnowledgeSourceForIndexing(ownerId, sourceId);
    if (!latest) {
      console.log(`[indexing] ${correlationId} claim-failed source-deleted`);
      throw sourceNotFound();
    }
    if (
      latest.processingStatus === "indexing" &&
      (latest.indexingLeaseExpiresAt ?? new Date(0)) > now()
    ) {
      console.log(`[indexing] ${correlationId} claim-failed indexing-in-progress`);
      throw new AppError(409, "SOURCE_INDEXING_IN_PROGRESS", "Knowledge source indexing is in progress");
    }
    console.log(`[indexing] ${correlationId} claim-failed race`);
    throw new AppError(409, "SOURCE_INDEXING_IN_PROGRESS", "Knowledge source indexing is in progress");
  }

  try {
    console.log(`[indexing] ${correlationId} ai-call-start`);
    const result = await client.index({
      ownerId,
      sourceId,
      contentVersion: claimed.contentVersion,
      content: claimed.content,
    });
    if (
      result.sourceId.toLowerCase() !== sourceId.toLowerCase() ||
      result.contentVersion !== claimed.contentVersion ||
      !result.chunkerVersion ||
      !result.embeddingModel ||
      !Number.isInteger(result.dimensions) ||
      result.dimensions < 1 ||
      !Number.isInteger(result.indexedChunkCount) ||
      result.indexedChunkCount < 1
    ) {
      const elapsedMs = Date.now() - startTime;
      console.log(`[indexing] ${correlationId} ai-response-invalid elapsed=${elapsedMs}ms`);
      throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response");
    }
    const metadata: KnowledgeSourceIndexingMetadata = {
      indexedContentVersion: result.contentVersion,
      indexedChunkerVersion: result.chunkerVersion,
      indexedEmbeddingModel: result.embeddingModel,
      indexedDimensions: result.dimensions,
      indexedChunkCount: result.indexedChunkCount,
    };
    const finalized = await repository.finalizeKnowledgeSourceIndexing(
      ownerId,
      sourceId,
      claimed.contentVersion,
      attemptId,
      "indexed",
      null,
      metadata,
    );
    if (!finalized) {
      const elapsedMs = Date.now() - startTime;
      console.log(`[indexing] ${correlationId} finalize-failed stale elapsed=${elapsedMs}ms`);
      throw new AppError(409, "SOURCE_INDEXING_STALE", "The indexing attempt is no longer current");
    }
    const elapsedMs = Date.now() - startTime;
    console.log(`[indexing] ${correlationId} success chunks=${result.indexedChunkCount} elapsed=${elapsedMs}ms`);
    return toPublicSource(finalized);
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    const safeFailureCodes = new Set([
      "AI_INVALID_RESPONSE",
      "AI_SERVICE_TIMEOUT",
      "AI_SERVICE_UNAVAILABLE",
      "AI_SERVICE_ERROR",
      "INDEXING_STORAGE_INCOMPATIBLE",
      "INDEXING_UNAVAILABLE",
      "INDEXING_TIMEOUT",
      "INDEXING_PROVIDER_BUSY",
      "INDEXING_INVALID_EMBEDDING",
      "INDEXING_FAILED",
    ]);
    const errorCode =
      error instanceof AppError && safeFailureCodes.has(error.code)
        ? error.code
        : "INDEXING_FAILED";
    const uncertainOutcome =
      error instanceof AppError &&
      (error.code === "AI_SERVICE_TIMEOUT" ||
        error.code === "AI_SERVICE_UNAVAILABLE");
    console.log(`[indexing] ${correlationId} error code=${errorCode} uncertain=${uncertainOutcome} elapsed=${elapsedMs}ms`);
    await repository.finalizeKnowledgeSourceIndexing(
      ownerId,
      sourceId,
      claimed.contentVersion,
      attemptId,
      "failed",
      errorCode,
      undefined,
      uncertainOutcome,
    );
    throw error;
  }
}
