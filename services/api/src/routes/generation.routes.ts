import { Router } from "express";
import {
  createGeneration,
  getGeneration,
} from "../controllers/generation.controller.js";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { generationRateLimitMiddleware } from "../middleware/generation-rate-limit.middleware.js";
import {
  validateParams,
  validateQuery,
  validateRequest,
} from "../middleware/validate-request.middleware.js";
import {
  generationQuerySchema,
  generationRequestSchema,
  signalGenerationParamsSchema,
} from "../validation/generation.validation.js";

export const generationRouter = Router({ mergeParams: true });

const validateSignalId = validateParams(
  signalGenerationParamsSchema,
  (locals, params) => {
    locals.signalId = params.signalId;
  },
);

generationRouter.post(
  "/",
  authenticationMiddleware,
  generationRateLimitMiddleware,
  validateSignalId,
  validateQuery(generationQuerySchema, () => undefined),
  validateRequest(generationRequestSchema),
  createGeneration,
);
generationRouter.get(
  "/",
  authenticationMiddleware,
  validateSignalId,
  validateQuery(generationQuerySchema, () => undefined),
  getGeneration,
);
