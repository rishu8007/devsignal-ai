import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { searchKnowledgeSourcesForUser } from "../services/knowledge-source-retrieval.service.js";
import type { KnowledgeSourceSearchInput } from "../validation/retrieval.validation.js";

export async function searchKnowledgeSources(
  request: Request<Record<string, never>, unknown, KnowledgeSourceSearchInput>,
  response: Response,
): Promise<void> {
  const ownerId = request.auth?.userId;
  if (!ownerId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }
  const candidates = await searchKnowledgeSourcesForUser(
    ownerId,
    request.body.query,
    request.body.limit,
  );
  response.status(200).json({
    success: true,
    data: {
      candidates,
    },
  });
}
