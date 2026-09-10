import rateLimit from "express-rate-limit";
import { AppError } from "../errors/app-error.js";

export const authRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, _response, next) => {
    next(new AppError(429, "RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later."));
  },
});
