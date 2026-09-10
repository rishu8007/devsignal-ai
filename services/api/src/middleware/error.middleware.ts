import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export const errorMiddleware: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  if (error instanceof AppError) {
    const publicError = {
      code: error.code,
      message: error.message,
    };

    response.status(error.statusCode).json({
      success: false,
      error: {
        ...publicError,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  console.error("Unhandled application error");
  response.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
};
