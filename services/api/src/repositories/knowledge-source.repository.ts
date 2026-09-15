import {
  KnowledgeSourceModel,
  type KnowledgeSourceDocument,
} from "../models/knowledge-source.model.js";
import type { KnowledgeSourceProcessingStatus } from "../models/knowledge-source.model.js";
import type {
  CreateKnowledgeSourceInput,
  ListKnowledgeSourcesQuery,
  UpdateKnowledgeSourceInput,
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
  const filter = {
    ownerId,
    ...(query.processingStatus ? { processingStatus: query.processingStatus } : {}),
  };
  return KnowledgeSourceModel.find(filter)
    .select("_id title content contentVersion processingStatus createdAt updatedAt")
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(query.limit)
    .lean<KnowledgeSourceDocument[]>()
    .exec();
}

export function countKnowledgeSourcesByOwner(
  ownerId: string,
  query: ListKnowledgeSourcesQuery,
): Promise<number> {
  return KnowledgeSourceModel.countDocuments({
    ownerId,
    ...(query.processingStatus ? { processingStatus: query.processingStatus } : {}),
  }).exec();
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

export function updateKnowledgeSourceIfVersionAndLeaseAvailable(
  ownerId: string,
  sourceId: string,
  input: UpdateKnowledgeSourceInput,
  now: Date,
): Promise<KnowledgeSourceDocument | null> {
  const changed = {
    $or: [
      { $ne: ["$title", { $literal: input.title }] },
      { $ne: ["$content", { $literal: input.content }] },
    ],
  };
  return KnowledgeSourceModel.findOneAndUpdate(
    {
      _id: sourceId,
      ownerId,
      contentVersion: input.expectedContentVersion,
      $or: [
        { indexingLeaseExpiresAt: null },
        { indexingLeaseExpiresAt: { $lte: now } },
      ],
    },
    [
      {
        $set: {
          title: { $literal: input.title },
          content: { $literal: input.content },
          contentVersion: {
            $cond: [changed, { $add: ["$contentVersion", 1] }, "$contentVersion"],
          },
          processingStatus: { $cond: [changed, { $literal: "pending" }, "$processingStatus"] },
          processingErrorCode: { $cond: [changed, { $literal: null }, "$processingErrorCode"] },
          indexingAttemptId: {
            $cond: [changed, null, "$indexingAttemptId"],
          },
          indexingLeaseExpiresAt: {
            $cond: [changed, null, "$indexingLeaseExpiresAt"],
          },
          indexedContentVersion: {
            $cond: [changed, null, "$indexedContentVersion"],
          },
          indexedChunkerVersion: {
            $cond: [changed, null, "$indexedChunkerVersion"],
          },
          indexedEmbeddingModel: {
            $cond: [changed, null, "$indexedEmbeddingModel"],
          },
          indexedDimensions: {
            $cond: [changed, null, "$indexedDimensions"],
          },
          indexedChunkCount: {
            $cond: [changed, null, "$indexedChunkCount"],
          },
          updatedAt: { $cond: [changed, "$$NOW", "$updatedAt"] },
        },
      },
    ],
    { new: true, timestamps: false, updatePipeline: true },
  )
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
