import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { listDraftsForUser } from "../services/draft.service.js";
import type { ListDraftsQuery } from "../validation/draft.validation.js";

export async function listDrafts(request: Request, response: Response): Promise<void> {
  const ownerId = request.auth?.userId;
  if (!ownerId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  const query = response.locals.draftQuery as ListDraftsQuery;
  const result = await listDraftsForUser(
    ownerId,
    query.page,
    query.limit,
    query.status,
  );
  response.status(200).json({ success: true, data: result });
}
