import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import {
  createEngagementForUser,
  deleteEngagementForUser,
  getAnalyticsForUser,
  updateEngagementForUser,
} from "../services/analytics.service.js";

function ownerId(request: Request): string {
  const value = request.auth?.userId;
  if (!value) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return value;
}

export async function getAnalytics(request: Request, response: Response): Promise<void> {
  const result = await getAnalyticsForUser(ownerId(request), response.locals.analyticsQuery);
  response.status(200).json({ success: true, data: result });
}

export async function createEngagement(request: Request, response: Response): Promise<void> {
  const snapshot = await createEngagementForUser(ownerId(request), request.body);
  response.status(201).json({ success: true, data: { snapshot } });
}

export async function updateEngagement(request: Request, response: Response): Promise<void> {
  const snapshotId = request.params.snapshotId;
  if (typeof snapshotId !== "string") throw new AppError(400, "VALIDATION_ERROR", "Invalid snapshot id");
  const snapshot = await updateEngagementForUser(ownerId(request), snapshotId, request.body);
  response.status(200).json({ success: true, data: { snapshot } });
}

export async function deleteEngagement(request: Request, response: Response): Promise<void> {
  const snapshotId = request.params.snapshotId;
  if (typeof snapshotId !== "string") throw new AppError(400, "VALIDATION_ERROR", "Invalid snapshot id");
  await deleteEngagementForUser(ownerId(request), snapshotId, request.body.expectedRevision);
  response.status(200).json({ success: true, data: { deleted: true } });
}
