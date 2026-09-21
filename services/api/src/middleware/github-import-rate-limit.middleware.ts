import rateLimit from "express-rate-limit";
import { AppError } from "../errors/app-error.js";

export const githubImportRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => request.auth?.userId ?? "unauthenticated",
  handler: (_request, _response, next) => {
    next(new AppError(429, "GITHUB_IMPORT_RATE_LIMIT_EXCEEDED", "Too many GitHub import requests. Please try again later."));
  },
});
