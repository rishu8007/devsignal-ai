import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { createSignalForUser, listSignalsForUser } from "../services/signal.service.js";
import type { CreateSignalInput, ListSignalsQuery } from "../validation/signal.validation.js";

export async function createSignal(
  request: Request<Record<string, string>, unknown, CreateSignalInput>,
  response: Response,
): Promise<void> {
  const ownerId = request.auth?.userId;
  if (!ownerId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  const signal = await createSignalForUser(ownerId, request.body);
  response.status(201).json({ success: true, data: { signal } });
}

export async function listSignals(request: Request, response: Response): Promise<void> {
  const ownerId = request.auth?.userId;
  if (!ownerId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  const query = response.locals.signalQuery;
  const result = await listSignalsForUser(ownerId, query);
  response.status(200).json({ success: true, data: result });
}
