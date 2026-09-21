import rateLimit from "express-rate-limit";
import { AppError } from "../errors/app-error.js";

export const linkedinPublishingRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => request.auth?.userId ?? "unauthenticated",
  handler: (_request, _response, next) => {
    next(new AppError(429, "LINKEDIN_PUBLISH_RATE_LIMIT_EXCEEDED", "Too many LinkedIn publishing requests. Please try again later."));
  },
});
