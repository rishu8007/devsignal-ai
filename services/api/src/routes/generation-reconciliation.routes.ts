import { Router } from "express";
import { z } from "zod";
import { reconcileGenerationOperation } from "../controllers/generation-reconciliation.controller.js";
import { reconciliationAdminMiddleware } from "../middleware/reconciliation-admin.middleware.js";
import { validateParams, validateRequest } from "../middleware/validate-request.middleware.js";

const paramsSchema = z.object({ operationId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
const bodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

export const generationReconciliationRouter = Router();
generationReconciliationRouter.post(
  "/:operationId/reconcile",
  reconciliationAdminMiddleware,
  validateParams(paramsSchema, () => undefined),
  validateRequest(bodySchema),
  reconcileGenerationOperation,
);
