import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { createResearchBriefForUser, getResearchBriefForUser, listResearchBriefsForUser } from "../services/research-brief.service.js";

function owner(request: Request) {
  const userId = request.auth?.userId;
  if (!userId) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return userId;
}
function param(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") throw new AppError(400, "VALIDATION_ERROR", "Invalid request data");
  return value;
}
export async function createResearchBrief(request: Request, response: Response) {
  response.status(201).json({ success: true, data: { brief: await createResearchBriefForUser(owner(request), param(request, "signalId"), request.body) } });
}
export async function listResearchBriefs(request: Request, response: Response) {
  response.json({ success: true, data: await listResearchBriefsForUser(owner(request), param(request, "signalId"), response.locals.researchQuery.page, response.locals.researchQuery.limit) });
}
export async function getResearchBrief(request: Request, response: Response) {
  response.json({ success: true, data: { brief: await getResearchBriefForUser(owner(request), param(request, "briefId")) } });
}
