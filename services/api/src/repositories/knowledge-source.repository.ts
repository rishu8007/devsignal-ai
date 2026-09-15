import {
  KnowledgeSourceModel,
  type KnowledgeSourceDocument,
} from "../models/knowledge-source.model.js";
import type { KnowledgeSourceProcessingStatus } from "../models/knowledge-source.model.js";
import type {
  CreateKnowledgeSourceInput,
  ListKnowledgeSourcesQuery,
} from "../validation/knowledge-source.validation.js";

export function createKnowledgeSource(
  ownerId: string,
  input: CreateKnowledgeSourceInput,
): Promise<KnowledgeSourceDocument> {
  return KnowledgeSourceModel.create({
    ownerId,
    ...input,
    contentVersion: 1,
    processingStatus: "pending",
  });
}

export function findKnowledgeSourcesByOwner(
  ownerId: string,
  query: ListKnowledgeSourcesQuery,
): Promise<KnowledgeSourceDocument[]> {
  const skip = (query.page - 1) * query.limit;
  return KnowledgeSourceModel.find({ ownerId })
    .select("_id title content contentVersion processingStatus createdAt updatedAt")
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(query.limit)
    .lean<KnowledgeSourceDocument[]>()
    .exec();
}

export function countKnowledgeSourcesByOwner(ownerId: string): Promise<number> {
  return KnowledgeSourceModel.countDocuments({ ownerId }).exec();
}

export function findKnowledgeSourceByIdAndOwner(
  ownerId: string,
  sourceId: string,
): Promise<KnowledgeSourceDocument | null> {
  return KnowledgeSourceModel.findOne({ _id: sourceId, ownerId })
    .select("_id title content contentVersion processingStatus createdAt updatedAt")
    .lean<KnowledgeSourceDocument>()
    .exec();
}

export function findKnowledgeSourcesByIdsAndOwner(
  ownerId: string,
  sourceIds: string[],
): Promise<KnowledgeSourceDocument[]> {
  return KnowledgeSourceModel.find({ _id: { $in: sourceIds }, ownerId })
    .select(
      "_id title content contentVersion processingStatus " +
        "+indexedContentVersion +indexedChunkerVersion +indexedEmbeddingModel +indexedDimensions",
    )
    .lean<KnowledgeSourceDocument[]>()
    .exec();
}

export function deleteKnowledgeSourceByIdAndOwner(
  ownerId: string,
  sourceId: string,
): Promise<KnowledgeSourceDocument | null> {
  return KnowledgeSourceModel.findOneAndDelete({ _id: sourceId, ownerId })
    .select("_id")
    .lean<KnowledgeSourceDocument>()
    .exec();
}

export interface KnowledgeSourceIndexingMetadata {
  indexedContentVersion: number;
  indexedChunkerVersion: string;
  indexedEmbeddingModel: string;
  indexedDimensions: number;
  indexedChunkCount: number;
}

export function findKnowledgeSourceForIndexing(
  ownerId: string,
  sourceId: string,
): Promise<KnowledgeSourceDocument | null> {
  return KnowledgeSourceModel.findOne({ _id: sourceId, ownerId })
    .select(
      "+indexingAttemptId +indexingLeaseExpiresAt +indexedContentVersion " +
        "+indexedChunkerVersion +indexedEmbeddingModel +indexedDimensions +indexedChunkCount",
    )
    .lean<KnowledgeSourceDocument>()
    .exec();
}

export function claimKnowledgeSourceIndexing(
  ownerId: string,
  sourceId: string,
  contentVersion: number,
  attemptId: string,
  leaseExpiresAt: Date,
): Promise<KnowledgeSourceDocument | null> {
  return KnowledgeSourceModel.findOneAndUpdate(
    {
      _id: sourceId,
      ownerId,
      contentVersion,
      $or: [
        {
          processingStatus: { $in: ["pending", "failed"] },
          $or: [
            { indexingLeaseExpiresAt: null },
            { indexingLeaseExpiresAt: { $lte: new Date() } },
          ],
        },
        { processingStatus: "indexing", indexingLeaseExpiresAt: { $lte: new Date() } },
      ],
    },
    {
      $set: {
        processingStatus: "indexing",
        processingErrorCode: null,
        indexingAttemptId: attemptId,
        indexingLeaseExpiresAt: leaseExpiresAt,
      },
    },
    { new: true },
  )
    .select(
      "+indexingAttemptId +indexingLeaseExpiresAt +indexedContentVersion " +
        "+indexedChunkerVersion +indexedEmbeddingModel +indexedDimensions +indexedChunkCount",
    )
    .lean<KnowledgeSourceDocument>()
    .exec();
}

export function finalizeKnowledgeSourceIndexing(
  ownerId: string,
  sourceId: string,
  contentVersion: number,
  attemptId: string,
  status: Extract<KnowledgeSourceProcessingStatus, "indexed" | "failed">,
  errorCode: string | null,
  metadata?: KnowledgeSourceIndexingMetadata,
  retainLease = false,
): Promise<KnowledgeSourceDocument | null> {
  const update = metadata
    ? {
        processingStatus: status,
        processingErrorCode: errorCode,
        ...(retainLease
          ? {}
          : { indexingAttemptId: null, indexingLeaseExpiresAt: null }),
        ...metadata,
      }
    : {
        processingStatus: status,
        processingErrorCode: errorCode,
        ...(retainLease
          ? {}
          : { indexingAttemptId: null, indexingLeaseExpiresAt: null }),
      };
  return KnowledgeSourceModel.findOneAndUpdate(
    { _id: sourceId, ownerId, contentVersion, processingStatus: "indexing", indexingAttemptId: attemptId },
    { $set: update },
    { new: true },
  )
    .select("+indexedContentVersion +indexedChunkerVersion +indexedEmbeddingModel +indexedDimensions +indexedChunkCount")
    .lean<KnowledgeSourceDocument>()
    .exec();
}

export function deleteKnowledgeSourceByIdAndOwnerIfNotIndexing(
  ownerId: string,
  sourceId: string,
): Promise<KnowledgeSourceDocument | null> {
  return KnowledgeSourceModel.findOneAndDelete({
    _id: sourceId,
    ownerId,
    $or: [
      {
        processingStatus: { $ne: "indexing" },
        $or: [
          { indexingLeaseExpiresAt: null },
          { indexingLeaseExpiresAt: { $lte: new Date() } },
        ],
      },
      { processingStatus: "indexing", indexingLeaseExpiresAt: { $lte: new Date() } },
    ],
  })
    .select("_id")
    .lean<KnowledgeSourceDocument>()
    .exec();
}
