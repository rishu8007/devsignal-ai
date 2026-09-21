import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { getProfessionalProfile, previewProfileKnowledge, saveProfessionalProfileForUser, saveProfileKnowledge } from "../services/professional-profile.service.js";

function owner(request: Request): string {
  const value = request.auth?.userId;
  if (!value) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return value;
}

export async function getProfile(request: Request, response: Response) {
  response.status(200).json({ success: true, data: { profile: await getProfessionalProfile(owner(request)) } });
}
export async function saveProfile(request: Request, response: Response) {
  response.status(200).json({ success: true, data: { profile: await saveProfessionalProfileForUser(owner(request), request.body) } });
}
export async function previewProfileExport(request: Request, response: Response) {
  response.status(200).json({ success: true, data: await previewProfileKnowledge(owner(request), request.body) });
}
export async function saveProfileExport(request: Request, response: Response) {
  response.status(200).json({ success: true, data: await saveProfileKnowledge(owner(request), request.body) });
}
