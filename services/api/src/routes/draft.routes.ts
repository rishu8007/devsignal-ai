import { Router } from "express";
import { listDrafts } from "../controllers/draft.controller.js";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateQuery } from "../middleware/validate-request.middleware.js";
import {
  listDraftsQuerySchema,
  type ListDraftsQuery,
} from "../validation/draft.validation.js";

export const draftRouter = Router();

draftRouter.get(
  "/",
  authenticationMiddleware,
  validateQuery(listDraftsQuerySchema, (locals, query: ListDraftsQuery) => {
    locals.draftQuery = query;
  }),
  listDrafts,
);
