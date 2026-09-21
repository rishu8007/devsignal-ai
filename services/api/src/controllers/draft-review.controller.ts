import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { applyDraftReviewForUser, createDraftReviewForUser, getDraftReviewForUser, listDraftReviewsForUser } from "../services/draft-review.service.js";

function owner(request: Request) {
  const ownerId = request.auth?.userId;
  if (!ownerId) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return ownerId;
}
function param(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") throw new AppError(400, "VALIDATION_ERROR", "Invalid request data");
  return value;
}
export async function createDraftReview(request: Request, response: Response): Promise<void> {
  const result = await createDraftReviewForUser(owner(request), response.locals.signalId, response.locals.variationId, request.body, undefined);
  response.status(201).json({ success: true, data: { review: result } });
}
export async function listDraftReviews(request: Request, response: Response): Promise<void> {
  const reviews = await listDraftReviewsForUser(owner(request), response.locals.signalId, response.locals.variationId);
  response.status(200).json({ success: true, data: { reviews } });
}
export async function getDraftReview(request: Request, response: Response): Promise<void> {
  const review = await getDraftReviewForUser(owner(request), response.locals.signalId, response.locals.variationId, param(request, "reviewId"));
  response.status(200).json({ success: true, data: { review } });
}
export async function applyDraftReview(request: Request, response: Response): Promise<void> {
  const generation = await applyDraftReviewForUser(owner(request), response.locals.signalId, response.locals.variationId, param(request, "reviewId"), request.body);
  response.status(200).json({ success: true, data: { generation } });
}
