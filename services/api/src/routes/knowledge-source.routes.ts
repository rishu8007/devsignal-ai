import { Router } from "express";
import { z } from "zod";
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  getKnowledgeSource,
  listKnowledgeSources,
  indexKnowledgeSource,
  updateKnowledgeSource,
} from "../controllers/knowledge-source.controller.js";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import {
  validateParams,
  validateQuery,
  validateRequest,
} from "../middleware/validate-request.middleware.js";
import {
  createKnowledgeSourceSchema,
  updateKnowledgeSourceSchema,
  knowledgeSourceParamsSchema,
  listKnowledgeSourcesQuerySchema,
  type KnowledgeSourceParams,
  type ListKnowledgeSourcesQuery,
} from "../validation/knowledge-source.validation.js";
import { searchKnowledgeSources } from "../controllers/knowledge-source-retrieval.controller.js";
import { knowledgeSourceSearchSchema } from "../validation/retrieval.validation.js";
import { githubImportRateLimitMiddleware } from "../middleware/github-import-rate-limit.middleware.js";
import {
  checkGithub,
  importGithub,
  previewGithub,
  readGithubFile,
  refreshGithub,
} from "../controllers/github-import.controller.js";
import {
  githubFileSchema,
  githubImportSchema,
  githubPreviewSchema,
  githubRefreshSchema,
} from "../validation/github-import.validation.js";

export const knowledgeSourceRouter = Router();

const validateSourceParams = validateParams(
  knowledgeSourceParamsSchema,
  (locals, params: KnowledgeSourceParams) => {
    locals.knowledgeSourceParams = params;
  },
);

knowledgeSourceRouter.use(authenticationMiddleware);
knowledgeSourceRouter.post("/", validateRequest(createKnowledgeSourceSchema), createKnowledgeSource);
knowledgeSourceRouter.post("/search", validateRequest(knowledgeSourceSearchSchema), searchKnowledgeSources);
knowledgeSourceRouter.post("/github/preview", githubImportRateLimitMiddleware, validateRequest(githubPreviewSchema), previewGithub);
knowledgeSourceRouter.post("/github/file", githubImportRateLimitMiddleware, validateRequest(githubFileSchema), readGithubFile);
knowledgeSourceRouter.post("/github/import", githubImportRateLimitMiddleware, validateRequest(githubImportSchema), importGithub);
knowledgeSourceRouter.get(
  "/",
  validateQuery(listKnowledgeSourcesQuerySchema, (locals, query: ListKnowledgeSourcesQuery) => {
    locals.knowledgeSourceQuery = query;
  }),
  listKnowledgeSources,
);
knowledgeSourceRouter.get("/:sourceId", validateSourceParams, getKnowledgeSource);
knowledgeSourceRouter.patch(
  "/:sourceId",
  validateSourceParams,
  validateRequest(updateKnowledgeSourceSchema),
  updateKnowledgeSource,
);
knowledgeSourceRouter.post("/:sourceId/index", validateSourceParams, validateRequest(z.object({}).strict()), indexKnowledgeSource);
knowledgeSourceRouter.post("/:sourceId/github/check", githubImportRateLimitMiddleware, validateSourceParams, checkGithub);
knowledgeSourceRouter.post("/:sourceId/github/refresh", githubImportRateLimitMiddleware, validateSourceParams, validateRequest(githubRefreshSchema), refreshGithub);
knowledgeSourceRouter.delete("/:sourceId", validateSourceParams, deleteKnowledgeSource);
