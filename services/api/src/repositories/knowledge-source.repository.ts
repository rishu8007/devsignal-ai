import {
  KnowledgeSourceModel,
  type KnowledgeSourceDocument,
} from "../models/knowledge-source.model.js";
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

export function deleteKnowledgeSourceByIdAndOwner(
  ownerId: string,
  sourceId: string,
): Promise<KnowledgeSourceDocument | null> {
  return KnowledgeSourceModel.findOneAndDelete({ _id: sourceId, ownerId })
    .select("_id")
    .lean<KnowledgeSourceDocument>()
    .exec();
}
