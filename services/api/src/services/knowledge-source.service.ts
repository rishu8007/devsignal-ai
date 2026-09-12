import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import {
  countKnowledgeSourcesByOwner,
  createKnowledgeSource,
  deleteKnowledgeSourceByIdAndOwner,
  findKnowledgeSourceByIdAndOwner,
  findKnowledgeSourcesByOwner,
} from "../repositories/knowledge-source.repository.js";
import type { KnowledgeSourceDocument } from "../models/knowledge-source.model.js";
import type {
  CreateKnowledgeSourceInput,
  ListKnowledgeSourcesQuery,
} from "../validation/knowledge-source.validation.js";

export interface PublicKnowledgeSourceDto {
  id: string;
  title: string;
  content: string;
  contentVersion: number;
  processingStatus: KnowledgeSourceDocument["processingStatus"];
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeSourceListResult {
  sources: PublicKnowledgeSourceDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface KnowledgeSourceRepositoryBoundary {
  createKnowledgeSource: typeof createKnowledgeSource;
  findKnowledgeSourcesByOwner: typeof findKnowledgeSourcesByOwner;
  countKnowledgeSourcesByOwner: typeof countKnowledgeSourcesByOwner;
  findKnowledgeSourceByIdAndOwner: typeof findKnowledgeSourceByIdAndOwner;
  deleteKnowledgeSourceByIdAndOwner: typeof deleteKnowledgeSourceByIdAndOwner;
}

const defaultRepository: KnowledgeSourceRepositoryBoundary = {
  createKnowledgeSource,
  findKnowledgeSourcesByOwner,
  countKnowledgeSourcesByOwner,
  findKnowledgeSourceByIdAndOwner,
  deleteKnowledgeSourceByIdAndOwner,
};

function assertValidOwnerId(ownerId: string): void {
  if (!Types.ObjectId.isValid(ownerId)) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }
}

function sourceNotFound(): AppError {
  return new AppError(404, "SOURCE_NOT_FOUND", "Knowledge source not found");
}

function toPublicKnowledgeSourceDto(
  source: KnowledgeSourceDocument,
): PublicKnowledgeSourceDto {
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

export async function createKnowledgeSourceForUser(
  ownerId: string,
  input: CreateKnowledgeSourceInput,
  repository: KnowledgeSourceRepositoryBoundary = defaultRepository,
): Promise<PublicKnowledgeSourceDto> {
  assertValidOwnerId(ownerId);
  const source = await repository.createKnowledgeSource(ownerId, input);
  return toPublicKnowledgeSourceDto(source);
}

export async function listKnowledgeSourcesForUser(
  ownerId: string,
  query: ListKnowledgeSourcesQuery,
  repository: KnowledgeSourceRepositoryBoundary = defaultRepository,
): Promise<KnowledgeSourceListResult> {
  assertValidOwnerId(ownerId);
  const [sources, total] = await Promise.all([
    repository.findKnowledgeSourcesByOwner(ownerId, query),
    repository.countKnowledgeSourcesByOwner(ownerId),
  ]);

  return {
    sources: sources.map(toPublicKnowledgeSourceDto),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
}

export async function getKnowledgeSourceForUser(
  ownerId: string,
  sourceId: string,
  repository: KnowledgeSourceRepositoryBoundary = defaultRepository,
): Promise<PublicKnowledgeSourceDto> {
  assertValidOwnerId(ownerId);
  const source = await repository.findKnowledgeSourceByIdAndOwner(ownerId, sourceId);
  if (!source) {
    throw sourceNotFound();
  }
  return toPublicKnowledgeSourceDto(source);
}

export async function deleteKnowledgeSourceForUser(
  ownerId: string,
  sourceId: string,
  repository: KnowledgeSourceRepositoryBoundary = defaultRepository,
): Promise<void> {
  assertValidOwnerId(ownerId);
  const source = await repository.deleteKnowledgeSourceByIdAndOwner(ownerId, sourceId);
  if (!source) {
    throw sourceNotFound();
  }
}
