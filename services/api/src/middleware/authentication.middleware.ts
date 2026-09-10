import type { RequestHandler } from "express";
import { getAuthenticatedUserId } from "../config/jwt.js";
import { AppError } from "../errors/app-error.js";
import { env } from "../config/env.js";

export const authenticationMiddleware: RequestHandler = (request, _response, next) => {
  const token = request.cookies?.[env.AUTH_COOKIE_NAME];
  const userId = typeof token === "string" ? getAuthenticatedUserId(token) : null;

  if (!userId) {
    next(new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required"));
    return;
  }

  request.auth = { userId };
  next();
};
