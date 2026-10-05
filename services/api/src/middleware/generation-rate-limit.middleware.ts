import rateLimit from "express-rate-limit";
import type { Request } from "express";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";

interface RateLimitedRequest extends Request {
  rateLimit?: {
    resetTime?: Date;
  };
}

const generationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => request.auth?.userId ?? "unauthenticated",
  handler: (request, response, next) => {
    const resetTime = (request as RateLimitedRequest).rateLimit?.resetTime?.getTime();
    const retryAfterSeconds = resetTime === undefined
      ? 15 * 60
      : Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
    response.setHeader("Retry-After", String(retryAfterSeconds));
    next(
      new AppError(
        429,
        "GENERATION_RATE_LIMIT_EXCEEDED",
        "Too many generation requests. Please try again later.",
      ),
    );
  },
});

export function createGenerationRateLimitMiddleware(
  enabled: boolean,
  limiter: RequestHandler = generationRateLimiter,
): RequestHandler {
  return (request, response, next) => {
    if (!enabled) {
      next();
      return;
    }
    limiter(request, response, next);
  };
}

export const generationRateLimitMiddleware = createGenerationRateLimitMiddleware(
  env.GENERATION_RATE_LIMIT_ENABLED,
);
