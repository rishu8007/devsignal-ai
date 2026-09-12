import { Router } from "express";
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  getKnowledgeSource,
  listKnowledgeSources,
} from "../controllers/knowledge-source.controller.js";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import {
  validateParams,
  validateQuery,
  validateRequest,
} from "../middleware/validate-request.middleware.js";
import {
  createKnowledgeSourceSchema,
  knowledgeSourceParamsSchema,
  listKnowledgeSourcesQuerySchema,
  type KnowledgeSourceParams,
  type ListKnowledgeSourcesQuery,
} from "../validation/knowledge-source.validation.js";

export const knowledgeSourceRouter = Router();

const validateSourceParams = validateParams(
  knowledgeSourceParamsSchema,
  (locals, params: KnowledgeSourceParams) => {
    locals.knowledgeSourceParams = params;
  },
);

knowledgeSourceRouter.use(authenticationMiddleware);
knowledgeSourceRouter.post("/", validateRequest(createKnowledgeSourceSchema), createKnowledgeSource);
knowledgeSourceRouter.get(
  "/",
  validateQuery(listKnowledgeSourcesQuerySchema, (locals, query: ListKnowledgeSourcesQuery) => {
    locals.knowledgeSourceQuery = query;
  }),
  listKnowledgeSources,
);
knowledgeSourceRouter.get("/:sourceId", validateSourceParams, getKnowledgeSource);
knowledgeSourceRouter.delete("/:sourceId", validateSourceParams, deleteKnowledgeSource);
