import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { reconcileUncertainGenerationForAdmin } from "../services/generation-reconciliation.service.js";

export async function reconcileGenerationOperation(
  request: Request<{ operationId: string }, unknown, { reason: string }>,
  response: Response,
): Promise<void> {
  const actor = request.get("X-Reconciliation-Actor")?.trim() || "local-admin";
  if (!/^[\w .:@/-]{1,120}$/.test(actor)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid reconciliation actor");
  }
  const result = await reconcileUncertainGenerationForAdmin(request.params.operationId, request.body.reason, actor);
  response.status(200).json({ success: true, data: { operation: result } });
}
