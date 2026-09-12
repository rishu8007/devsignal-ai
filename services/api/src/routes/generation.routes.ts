import { Router } from "express";
import {
  approveGenerationVariation,
  createGeneration,
  editGenerationVariation,
  getGeneration,
  scheduleGenerationVariation,
  clearGenerationVariationSchedule,
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
  approveGenerationVariationSchema,
  editGenerationVariationSchema,
  scheduleGenerationVariationSchema,
  generationVariationParamsSchema,
  signalGenerationParamsSchema,
} from "../validation/generation.validation.js";

export const generationRouter = Router({ mergeParams: true });

const validateSignalId = validateParams(
  signalGenerationParamsSchema,
  (locals, params) => {
    locals.signalId = params.signalId;
  },
);

const validateVariationParams = validateParams(
  generationVariationParamsSchema,
  (locals, params) => {
    locals.signalId = params.signalId;
    locals.variationId = params.variationId;
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

generationRouter.put(
  "/:variationId/schedule",
  authenticationMiddleware,
  validateVariationParams,
  validateRequest(scheduleGenerationVariationSchema),
  scheduleGenerationVariation,
);

generationRouter.delete(
  "/:variationId/schedule",
  authenticationMiddleware,
  validateVariationParams,
  clearGenerationVariationSchedule,
);
generationRouter.get(
  "/",
  authenticationMiddleware,
  validateSignalId,
  validateQuery(generationQuerySchema, () => undefined),
  getGeneration,
);

generationRouter.patch(
  "/:variationId",
  authenticationMiddleware,
  validateVariationParams,
  validateRequest(editGenerationVariationSchema),
  editGenerationVariation,
);

generationRouter.post(
  "/:variationId/approve",
  authenticationMiddleware,
  validateVariationParams,
  validateRequest(approveGenerationVariationSchema),
  approveGenerationVariation,
);
