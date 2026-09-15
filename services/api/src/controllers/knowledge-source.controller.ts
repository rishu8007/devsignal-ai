import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import {
  createKnowledgeSourceForUser,
  deleteKnowledgeSourceForUser,
  getKnowledgeSourceForUser,
  listKnowledgeSourcesForUser,
  updateKnowledgeSourceForUser,
} from "../services/knowledge-source.service.js";
import { indexKnowledgeSourceForUser } from "../services/knowledge-source-indexing.service.js";
import type {
  CreateKnowledgeSourceInput,
  KnowledgeSourceParams,
  ListKnowledgeSourcesQuery,
  UpdateKnowledgeSourceInput,
} from "../validation/knowledge-source.validation.js";

function requireOwnerId(request: Request): string {
  const ownerId = request.auth?.userId;
  if (!ownerId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }
  return ownerId;
}

export async function createKnowledgeSource(
  request: Request<Record<string, string>, unknown, CreateKnowledgeSourceInput>,
  response: Response,
): Promise<void> {
  const source = await createKnowledgeSourceForUser(requireOwnerId(request), request.body);
  response.status(201).json({ success: true, data: { source } });
}

export async function listKnowledgeSources(
  request: Request,
  response: Response,
): Promise<void> {
  const query = response.locals.knowledgeSourceQuery as ListKnowledgeSourcesQuery;
  const result = await listKnowledgeSourcesForUser(requireOwnerId(request), query);
  response.status(200).json({ success: true, data: result });
}

export async function getKnowledgeSource(
  request: Request,
  response: Response,
): Promise<void> {
  const params = response.locals.knowledgeSourceParams as KnowledgeSourceParams;
  const source = await getKnowledgeSourceForUser(requireOwnerId(request), params.sourceId);
  response.status(200).json({ success: true, data: { source } });
}

export async function deleteKnowledgeSource(
  request: Request,
  response: Response,
): Promise<void> {
  const params = response.locals.knowledgeSourceParams as KnowledgeSourceParams;
  await deleteKnowledgeSourceForUser(requireOwnerId(request), params.sourceId);
  response.status(200).json({
    success: true,
    data: { message: "Knowledge source deleted" },
  });
}

export async function updateKnowledgeSource(
  request: Request<Record<string, string>, unknown, UpdateKnowledgeSourceInput>,
  response: Response,
): Promise<void> {
  const params = response.locals.knowledgeSourceParams as KnowledgeSourceParams;
  const source = await updateKnowledgeSourceForUser(
    requireOwnerId(request),
    params.sourceId,
    request.body,
  );
  response.status(200).json({ success: true, data: { source } });
}

export async function indexKnowledgeSource(
  request: Request,
  response: Response,
): Promise<void> {
  const params = response.locals.knowledgeSourceParams as KnowledgeSourceParams;
  const source = await indexKnowledgeSourceForUser(requireOwnerId(request), params.sourceId);
  response.status(200).json({ success: true, data: { source } });
}
