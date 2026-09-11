import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import {
  approveGenerationVariationForSignal,
  createGenerationForSignal,
  editGenerationVariationForSignal,
  getGenerationForSignal,
} from "../services/generation.service.js";
import type { EditGenerationVariationInput } from "../validation/generation.validation.js";

export async function createGeneration(request: Request, response: Response): Promise<void> {
  const ownerId = request.auth?.userId;
  const signalId = response.locals.signalId;
  if (!ownerId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  const result = await createGenerationForSignal(ownerId, signalId);
  response.status(result.created ? 201 : 200).json({
    success: true,
    data: { generation: result.generation },
  });
}

export async function getGeneration(request: Request, response: Response): Promise<void> {
  const ownerId = request.auth?.userId;
  const signalId = response.locals.signalId;
  if (!ownerId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  const generation = await getGenerationForSignal(ownerId, signalId);
  response.status(200).json({ success: true, data: { generation } });
}

export async function editGenerationVariation(
  request: Request<Record<string, string>, unknown, EditGenerationVariationInput>,
  response: Response,
): Promise<void> {
  const ownerId = request.auth?.userId;
  const { signalId, variationId } = response.locals;
  if (!ownerId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  const generation = await editGenerationVariationForSignal(
    ownerId,
    signalId,
    variationId,
    request.body.content,
  );
  response.status(200).json({ success: true, data: { generation } });
}

export async function approveGenerationVariation(
  request: Request,
  response: Response,
): Promise<void> {
  const ownerId = request.auth?.userId;
  const { signalId, variationId } = response.locals;
  if (!ownerId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  const generation = await approveGenerationVariationForSignal(
    ownerId,
    signalId,
    variationId,
  );
  response.status(200).json({ success: true, data: { generation } });
}
