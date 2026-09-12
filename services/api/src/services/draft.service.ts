import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import { listDraftsByOwner } from "../repositories/generation.repository.js";
import type { DraftStatus, PublicDraftListItem } from "../types/draft.js";

export interface DraftRepositoryBoundary {
  listDraftsByOwner: typeof listDraftsByOwner;
}

const defaultRepository: DraftRepositoryBoundary = { listDraftsByOwner };

export interface PublicDraftLibrary {
  drafts: PublicDraftListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: {
    draft: number;
    approved: number;
    scheduled: number;
    total: number;
  };
}

export async function listDraftsForUser(
  ownerId: string,
  page: number,
  limit: number,
  status: DraftStatus | undefined,
  repository: DraftRepositoryBoundary = defaultRepository,
): Promise<PublicDraftLibrary> {
  if (!Types.ObjectId.isValid(ownerId)) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  const result = await repository.listDraftsByOwner(ownerId, page, limit, status);
  return {
    drafts: result.drafts,
    pagination: {
      page,
      limit,
      total: result.total,
      totalPages: result.total === 0 ? 0 : Math.ceil(result.total / limit),
    },
    summary: result.summary,
  };
}
