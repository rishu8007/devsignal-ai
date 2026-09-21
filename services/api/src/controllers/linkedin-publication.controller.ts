import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import {
  confirmLinkedInPublication,
  createLinkedInPublicationPreview,
  listLinkedInPublicationHistory,
} from "../services/linkedin-publication.service.js";

function ownerId(request: Request): string {
  const value = request.auth?.userId;
  if (!value) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
  return value;
}

export async function previewLinkedInPublication(request: Request, response: Response): Promise<void> {
  const preview = await createLinkedInPublicationPreview(
    ownerId(request),
    request.body.signalId,
    request.body.variationId,
  );
  response.status(200).json({ success: true, data: { preview } });
}

export async function confirmLinkedInPublicationRequest(request: Request, response: Response): Promise<void> {
  const publication = await confirmLinkedInPublication(ownerId(request), request.body.previewId);
  response.status(200).json({ success: true, data: { publication } });
}

export async function getLinkedInPublicationHistory(request: Request, response: Response): Promise<void> {
  const publications = await listLinkedInPublicationHistory(ownerId(request));
  response.status(200).json({ success: true, data: { publications } });
}
