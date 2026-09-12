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
  if (!Types.ObjectId.isValid(ownerId) || !Types.ObjectId.isValid(sourceId)) {
    throw sourceNotFound();
  }
  const current = await repository.findKnowledgeSourceForIndexing(ownerId, sourceId);
  if (!current) {
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
    return toPublicSource(current);
  }
  if (
    current.processingStatus === "indexing" &&
    (current.indexingLeaseExpiresAt ?? new Date(0)) > now()
  ) {
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
      throw sourceNotFound();
    }
    if (
      latest.processingStatus === "indexing" &&
      (latest.indexingLeaseExpiresAt ?? new Date(0)) > now()
    ) {
      throw new AppError(409, "SOURCE_INDEXING_IN_PROGRESS", "Knowledge source indexing is in progress");
    }
    throw new AppError(409, "SOURCE_INDEXING_IN_PROGRESS", "Knowledge source indexing is in progress");
  }

  try {
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
      throw new AppError(409, "SOURCE_INDEXING_STALE", "The indexing attempt is no longer current");
    }
    return toPublicSource(finalized);
  } catch (error) {
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
