import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export const notFoundMiddleware: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, "ROUTE_NOT_FOUND", "Route not found"));
};
