import { Router } from "express";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateQuery, validateRequest } from "../middleware/validate-request.middleware.js";
import { createTopicPlan, convertTopicSuggestion, getTopicPlan, listTopicPlans } from "../controllers/topic-planning.controller.js";
import { topicConversionSchema, topicPlansQuerySchema, topicPlanningRequestSchema } from "../validation/topic-planning.validation.js";
import rateLimit from "express-rate-limit";
import { AppError } from "../errors/app-error.js";

const topicPlanningRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (request) => request.auth?.userId ?? "unauthenticated",
  handler: (_request, _response, next) => next(new AppError(429, "TOPIC_PLANNING_RATE_LIMITED", "Too many topic planning requests; try again later.")),
});
export const topicPlanningRouter = Router();
topicPlanningRouter.use(authenticationMiddleware);
topicPlanningRouter.post("/", topicPlanningRateLimit, validateRequest(topicPlanningRequestSchema), createTopicPlan);
topicPlanningRouter.get("/", validateQuery(topicPlansQuerySchema, (locals, query) => { locals.topicPlansQuery = query; }), listTopicPlans);
topicPlanningRouter.get("/:runId", getTopicPlan);
topicPlanningRouter.post("/:runId/convert", validateRequest(topicConversionSchema), convertTopicSuggestion);
