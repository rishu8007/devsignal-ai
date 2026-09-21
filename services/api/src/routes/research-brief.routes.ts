import { Router } from "express";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateParams, validateQuery, validateRequest } from "../middleware/validate-request.middleware.js";
import { createResearchBrief, getResearchBrief, listResearchBriefs } from "../controllers/research-brief.controller.js";
import { researchBriefQuerySchema, researchBriefRequestSchema } from "../validation/research-brief.validation.js";
import { signalParamsSchema } from "../validation/signal.validation.js";
import rateLimit from "express-rate-limit";
import { AppError } from "../errors/app-error.js";

const researchRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => request.auth?.userId ?? "unauthenticated",
  handler: (_request, _response, next) => next(new AppError(429, "RESEARCH_RATE_LIMITED", "Too many research requests; try again later.")),
});
export const researchBriefRouter = Router({ mergeParams: true });
researchBriefRouter.use(authenticationMiddleware);
researchBriefRouter.get("/", validateParams(signalParamsSchema, () => undefined), validateQuery(researchBriefQuerySchema, (locals, query) => { locals.researchQuery = query; }), listResearchBriefs);
researchBriefRouter.post("/", researchRateLimit, validateParams(signalParamsSchema, () => undefined), validateRequest(researchBriefRequestSchema), createResearchBrief);
export const researchBriefDetailRouter = Router({ mergeParams: true });
researchBriefDetailRouter.use(authenticationMiddleware);
researchBriefDetailRouter.get("/:briefId", getResearchBrief);
