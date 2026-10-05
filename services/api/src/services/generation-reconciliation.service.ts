import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import {
  findUsageById,
  reconcileUncertainGeneration,
} from "../repositories/usage.repository.js";
import { hasAnyActiveSignalGenerationLease } from "../repositories/signal.repository.js";
import { hasInFlightGeneration } from "./generation.service.js";

interface ReconciliationRepository {
  findUsageById: typeof findUsageById;
  reconcileUncertainGeneration: typeof reconcileUncertainGeneration;
  hasAnyActiveSignalGenerationLease: typeof hasAnyActiveSignalGenerationLease;
}

const defaultRepository: ReconciliationRepository = {
  findUsageById,
  reconcileUncertainGeneration,
  hasAnyActiveSignalGenerationLease,
};

export async function reconcileUncertainGenerationForAdmin(
  operationId: string,
  reason: string,
  reconciledBy: string,
  now = new Date(),
  repository: ReconciliationRepository = defaultRepository,
) {
  if (!Types.ObjectId.isValid(operationId)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid operation ID");
  }
  const operation = await repository.findUsageById(operationId);
  if (!operation || operation.operationType !== "generation") {
    throw new AppError(404, "AI_OPERATION_NOT_FOUND", "AI operation not found");
  }
  if (operation.status !== "uncertain" || operation.expiresAt > now) {
    throw new AppError(409, "AI_OPERATION_NOT_RECONCILABLE", "AI operation is not an expired uncertain generation");
  }
  const match = /^generation:([a-f\d]{24}):[^:]+$/i.exec(operation.operationKey);
  if (!match?.[1]) {
    throw new AppError(409, "AI_OPERATION_NOT_RECONCILABLE", "AI operation has no reconciliable Signal lease identity");
  }
  const signalId = match[1];
  const ownerId = operation.ownerId.toString();
  if (hasInFlightGeneration(ownerId, signalId)) {
    throw new AppError(409, "AI_OPERATION_IN_PROGRESS", "The generation request is still in progress");
  }
  if (await repository.hasAnyActiveSignalGenerationLease(ownerId, signalId, now)) {
    throw new AppError(409, "AI_OPERATION_IN_PROGRESS", "The Signal generation lease is still active");
  }
  const reconciled = await repository.reconcileUncertainGeneration(operationId, reconciledBy, reason, now);
  if (!reconciled) {
    throw new AppError(409, "AI_OPERATION_RECONCILIATION_CONFLICT", "The AI operation changed before reconciliation");
  }
  return {
    operationId: reconciled._id.toString(),
    operationType: reconciled.operationType,
    status: reconciled.status,
    reconciledAt: reconciled.reconciledAt,
    reconciledBy: reconciled.reconciledBy,
    reconciliationReason: reconciled.reconciliationReason,
  };
}
