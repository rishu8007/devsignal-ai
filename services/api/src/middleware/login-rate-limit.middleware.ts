import rateLimit from "express-rate-limit";
import { AppError } from "../errors/app-error.js";

export const loginRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, _response, next) => {
    next(
      new AppError(
        429,
        "LOGIN_RATE_LIMIT_EXCEEDED",
        "Too many login attempts. Please try again later.",
      ),
    );
  },
});
