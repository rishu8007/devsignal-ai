import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getConfiguredOrigin(): string {
  return new URL(env.WEB_ORIGIN).origin;
}

export const sameOriginMiddleware: RequestHandler = (request, _response, next) => {
  if (!stateChangingMethods.has(request.method)) {
    next();
    return;
  }

  const authCookie = request.cookies?.[env.AUTH_COOKIE_NAME];
  if (typeof authCookie !== "string" || authCookie.length === 0) {
    next();
    return;
  }

  if (request.get("origin") !== getConfiguredOrigin()) {
    next(
      new AppError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "The request origin is not allowed for cookie-authenticated writes.",
      ),
    );
    return;
  }

  next();
};
