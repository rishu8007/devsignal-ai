import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { getUsageForUser } from "../services/usage.service.js";
export async function getUsage(request: Request, response: Response) {
  const ownerId = request.auth?.userId;
  if (!ownerId) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  response.status(200).json({ success: true, data: await getUsageForUser(ownerId) });
}
