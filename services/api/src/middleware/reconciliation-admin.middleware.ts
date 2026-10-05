import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";

export const reconciliationAdminMiddleware: RequestHandler = (request, _response, next) => {
  const configured = env.AI_RECONCILIATION_ADMIN_KEY;
  const supplied = request.get("X-Reconciliation-Admin-Key");
  const valid = Boolean(
    configured &&
    supplied &&
    configured.length === supplied.length &&
    timingSafeEqual(Buffer.from(configured), Buffer.from(supplied)),
  );
  if (!valid) {
    next(new AppError(403, "RECONCILIATION_NOT_AUTHORIZED", "Reconciliation is not authorized"));
    return;
  }
  next();
};
