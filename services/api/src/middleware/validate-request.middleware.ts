import type { RequestHandler } from "express";
import { z, type ZodType } from "zod";
import { AppError, type PublicErrorDetails } from "../errors/app-error.js";

function getValidationDetails(error: z.ZodError): PublicErrorDetails {
  const fields: Record<string, string[]> = {};

  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        fields[key] = [...(fields[key] ?? []), "Unknown field"];
      }
      continue;
    }

    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_root";
    fields[field] = [...(fields[field] ?? []), issue.message];
  }

  return { fields };
}

export function validateRequest(schema: ZodType<unknown>): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body);

    if (!result.success) {
      next(
        new AppError(
          400,
          "VALIDATION_ERROR",
          "Invalid request data",
          true,
          getValidationDetails(result.error),
        ),
      );
      return;
    }

    request.body = result.data;
    next();
  };
}

export function validateQuery<T>(
  schema: ZodType<T>,
  assign: (locals: Express.Locals, data: T) => void,
): RequestHandler {
  return (request, response, next) => {
    const result = schema.safeParse(request.query);

    if (!result.success) {
      next(
        new AppError(
          400,
          "VALIDATION_ERROR",
          "Invalid request data",
          true,
          getValidationDetails(result.error),
        ),
      );
      return;
    }

    assign(response.locals, result.data);
    next();
  };
}
