import { Router } from "express";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateParams, validateQuery, validateRequest } from "../middleware/validate-request.middleware.js";
import {
  analyticsQuerySchema,
  engagementCreateSchema,
  engagementDeleteSchema,
  engagementParamsSchema,
  engagementUpdateSchema,
  type AnalyticsQuery,
} from "../validation/analytics.validation.js";
import { createEngagement, deleteEngagement, getAnalytics, updateEngagement } from "../controllers/analytics.controller.js";

export const analyticsRouter = Router();
analyticsRouter.use(authenticationMiddleware);
analyticsRouter.get("/", validateQuery(analyticsQuerySchema, (locals, query: AnalyticsQuery) => { locals.analyticsQuery = query; }), getAnalytics);
analyticsRouter.post("/engagement", validateRequest(engagementCreateSchema), createEngagement);
analyticsRouter.patch("/engagement/:snapshotId", validateParams(engagementParamsSchema, (locals, params) => { locals.snapshotId = params.snapshotId; }), validateRequest(engagementUpdateSchema), updateEngagement);
analyticsRouter.delete("/engagement/:snapshotId", validateParams(engagementParamsSchema, (locals, params) => { locals.snapshotId = params.snapshotId; }), validateRequest(engagementDeleteSchema), deleteEngagement);
