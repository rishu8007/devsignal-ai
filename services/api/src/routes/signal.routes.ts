import { Router } from "express";
import { createSignal, listSignals, updateSignal } from "../controllers/signal.controller.js";
import { generationRouter } from "./generation.routes.js";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import {
  validateParams,
  validateQuery,
  validateRequest,
} from "../middleware/validate-request.middleware.js";
import {
  createSignalSchema,
  updateSignalSchema,
  listSignalsQuerySchema,
  type ListSignalsQuery,
  signalParamsSchema,
} from "../validation/signal.validation.js";
import { researchBriefRouter, researchBriefDetailRouter } from "./research-brief.routes.js";

export const signalRouter = Router();

signalRouter.use("/:signalId/generations", generationRouter);
signalRouter.use("/:signalId/research", researchBriefRouter);
signalRouter.use("/:signalId/research-briefs", researchBriefDetailRouter);

signalRouter.post(
  "/",
  authenticationMiddleware,
  validateRequest(createSignalSchema),
  createSignal,
);
signalRouter.get(
  "/",
  authenticationMiddleware,
  validateQuery(listSignalsQuerySchema, (locals, query: ListSignalsQuery) => {
    locals.signalQuery = query;
  }),
  listSignals,
);
signalRouter.patch(
  "/:signalId",
  authenticationMiddleware,
  validateParams(signalParamsSchema, (locals, params) => {
    locals.signalId = params.signalId;
  }),
  validateRequest(updateSignalSchema),
  updateSignal,
);
