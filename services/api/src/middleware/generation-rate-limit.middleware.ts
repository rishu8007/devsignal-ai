import rateLimit from "express-rate-limit";
import { AppError } from "../errors/app-error.js";

export const generationRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => request.auth?.userId ?? "unauthenticated",
  handler: (_request, _response, next) => {
    next(
      new AppError(
        429,
        "GENERATION_RATE_LIMIT_EXCEEDED",
        "Too many generation requests. Please try again later.",
      ),
    );
  },
});
