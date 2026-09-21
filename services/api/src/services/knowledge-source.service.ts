import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import {
  countKnowledgeSourcesByOwner,
  createKnowledgeSource,
  deleteKnowledgeSourceByIdAndOwner,
  deleteKnowledgeSourceByIdAndOwnerIfNotIndexing,
  finalizeKnowledgeSourceIndexing,
  findKnowledgeSourceForIndexing,
  claimKnowledgeSourceIndexing,
  findKnowledgeSourceByIdAndOwner,
  findKnowledgeSourcesByOwner,
  updateKnowledgeSourceIfVersionAndLeaseAvailable,
} from "../repositories/knowledge-source.repository.js";
import type { KnowledgeSourceDocument } from "../models/knowledge-source.model.js";
import type {
  CreateKnowledgeSourceInput,
  ListKnowledgeSourcesQuery,
  UpdateKnowledgeSourceInput,
} from "../validation/knowledge-source.validation.js";

export interface PublicKnowledgeSourceDto {
  id: string;
  title: string;
  content: string;
  contentVersion: number;
  processingStatus: KnowledgeSourceDocument["processingStatus"];
  createdAt: Date;
  updatedAt: Date;
  github?: {
    repositoryUrl: string;
    branch: string;
    path: string;
    commitSha: string;
    blobSha: string;
    importedContentHash: string;
  };
  profile?: {
    profileId: string;
    section: "summary" | "resume" | "project";
    projectId?: string;
    profileRevision: number;
    contentHash?: string;
  };
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
  updateKnowledgeSourceIfVersionAndLeaseAvailable?: typeof updateKnowledgeSourceIfVersionAndLeaseAvailable;
  deleteKnowledgeSourceByIdAndOwner: typeof deleteKnowledgeSourceByIdAndOwner;
  deleteKnowledgeSourceByIdAndOwnerIfNotIndexing: typeof deleteKnowledgeSourceByIdAndOwnerIfNotIndexing;
  findKnowledgeSourceForIndexing: typeof findKnowledgeSourceForIndexing;
  claimKnowledgeSourceIndexing: typeof claimKnowledgeSourceIndexing;
  finalizeKnowledgeSourceIndexing: typeof finalizeKnowledgeSourceIndexing;
}

const defaultRepository: KnowledgeSourceRepositoryBoundary = {
  createKnowledgeSource,
  findKnowledgeSourcesByOwner,
  countKnowledgeSourcesByOwner,
  findKnowledgeSourceByIdAndOwner,
  updateKnowledgeSourceIfVersionAndLeaseAvailable,
  deleteKnowledgeSourceByIdAndOwner,
  deleteKnowledgeSourceByIdAndOwnerIfNotIndexing,
  findKnowledgeSourceForIndexing,
  claimKnowledgeSourceIndexing,
  finalizeKnowledgeSourceIndexing,
};

function assertValidOwnerId(ownerId: string): void {
  if (!Types.ObjectId.isValid(ownerId)) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }
}

function sourceNotFound(): AppError {
  return new AppError(404, "SOURCE_NOT_FOUND", "Knowledge source not found");
}

export function toPublicKnowledgeSourceDto(
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
    ...(source.github?.repositoryUrl &&
    source.github.branch &&
    source.github.path &&
    source.github.commitSha &&
    source.github.blobSha &&
    source.github.importedContentHash
      ? {
          github: {
            repositoryUrl: source.github.repositoryUrl,
            branch: source.github.branch,
            path: source.github.path,
            commitSha: source.github.commitSha,
            blobSha: source.github.blobSha,
            importedContentHash: source.github.importedContentHash,
          },
        }
      : {}),
    ...(source.profile?.profileId &&
    source.profile.section &&
    source.profile.profileRevision
      ? {
          profile: {
            profileId: source.profile.profileId.toString(),
            section: source.profile.section,
            ...(source.profile.projectId
              ? { projectId: source.profile.projectId.toString() }
              : {}),
            profileRevision: source.profile.profileRevision,
            ...(source.profile.contentHash ? { contentHash: source.profile.contentHash } : {}),
          },
        }
      : {}),
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
    repository.countKnowledgeSourcesByOwner(ownerId, query),
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
  const source = await repository.deleteKnowledgeSourceByIdAndOwnerIfNotIndexing(ownerId, sourceId);
  if (!source) {
    const current = await repository.findKnowledgeSourceForIndexing(ownerId, sourceId);
    if ((current?.indexingLeaseExpiresAt ?? new Date(0)) > new Date()) {
      throw new AppError(409, "SOURCE_INDEXING_IN_PROGRESS", "Knowledge source indexing is in progress");
    }
    throw sourceNotFound();
  }
}

export async function updateKnowledgeSourceForUser(
  ownerId: string,
  sourceId: string,
  input: UpdateKnowledgeSourceInput,
  repository: KnowledgeSourceRepositoryBoundary = defaultRepository,
  now: () => Date = () => new Date(),
): Promise<PublicKnowledgeSourceDto> {
  assertValidOwnerId(ownerId);
  if (!repository.updateKnowledgeSourceIfVersionAndLeaseAvailable) {
    throw new AppError(500, "INTERNAL_ERROR", "Knowledge source update is unavailable");
  }
  const updated = await repository.updateKnowledgeSourceIfVersionAndLeaseAvailable(
    ownerId,
    sourceId,
    input,
    now(),
  );
  if (updated) {
    return toPublicKnowledgeSourceDto(updated);
  }

  const current = await repository.findKnowledgeSourceForIndexing(ownerId, sourceId);
  if (!current) {
    throw sourceNotFound();
  }
  if ((current.indexingLeaseExpiresAt ?? new Date(0)) > now()) {
    throw new AppError(409, "SOURCE_INDEXING_IN_PROGRESS", "Knowledge source indexing is in progress");
  }
  throw new AppError(409, "SOURCE_VERSION_CONFLICT", "Knowledge source changed; reload before saving");
}
