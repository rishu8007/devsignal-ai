import { Router } from "express";
import { createSignal, listSignals } from "../controllers/signal.controller.js";
import { generationRouter } from "./generation.routes.js";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateQuery, validateRequest } from "../middleware/validate-request.middleware.js";
import {
  createSignalSchema,
  listSignalsQuerySchema,
  type ListSignalsQuery,
} from "../validation/signal.validation.js";

export const signalRouter = Router();

signalRouter.use("/:signalId/generations", generationRouter);

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
