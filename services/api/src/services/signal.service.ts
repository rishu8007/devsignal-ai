import {
  countSignalsByOwner,
  createSignal,
  findSignalsByOwner,
  findSignalByIdAndOwner,
  updateSignalIfEditable,
} from "../repositories/signal.repository.js";
import { findGenerationByOwnerAndSignal } from "../repositories/generation.repository.js";
import { AppError } from "../errors/app-error.js";
import { Types } from "mongoose";
import type { SignalDocument } from "../models/signal.model.js";
import type {
  SignalContentType,
  SignalPrimaryAudience,
} from "../constants/signal.constants.js";
import type {
  CreateSignalInput,
  ListSignalsQuery,
  UpdateSignalInput,
} from "../validation/signal.validation.js";

export interface SignalMutationRepository {
  findSignalByIdAndOwner: typeof findSignalByIdAndOwner;
  findGenerationByOwnerAndSignal: typeof findGenerationByOwnerAndSignal;
  updateSignalIfEditable: typeof updateSignalIfEditable;
}

const defaultMutationRepository: SignalMutationRepository = {
  findSignalByIdAndOwner,
  findGenerationByOwnerAndSignal,
  updateSignalIfEditable,
};

export interface PublicSignalDto {
  id: string;
  topic: string;
  notes: string;
  primaryAudience: SignalPrimaryAudience;
  contentType: SignalContentType;
  createdAt: Date;
  updatedAt: Date;
  revision: number;
}

export interface SignalListResult {
  signals: PublicSignalDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function toPublicSignalDto(signal: SignalDocument): PublicSignalDto {
  return {
    id: signal._id.toString(),
    topic: signal.topic,
    notes: signal.notes,
    primaryAudience: signal.primaryAudience,
    contentType: signal.contentType,
    createdAt: signal.createdAt,
    updatedAt: signal.updatedAt,
    revision: signal.revision ?? 1,
  };
}

export async function createSignalForUser(
  ownerId: string,
  input: CreateSignalInput,
): Promise<PublicSignalDto> {
  return toPublicSignalDto(await createSignal(ownerId, input));
}

export async function updateSignalForUser(
  ownerId: string,
  signalId: string,
  input: UpdateSignalInput,
  now = new Date(),
  repository: SignalMutationRepository = defaultMutationRepository,
): Promise<PublicSignalDto> {
  if (!Types.ObjectId.isValid(signalId)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid request data");
  }
  const current = await repository.findSignalByIdAndOwner(ownerId, signalId);
  if (!current) {
    throw new AppError(404, "SIGNAL_NOT_FOUND", "Signal not found");
  }
  if (await repository.findGenerationByOwnerAndSignal(ownerId, signalId)) {
    throw new AppError(409, "SIGNAL_GENERATION_EXISTS", "This Signal cannot be edited after generation");
  }
  if (
    current.generationLeaseId &&
    current.generationLeaseState === "persisting"
  ) {
    throw new AppError(
      409,
      "SIGNAL_GENERATION_IN_PROGRESS",
      "This Signal has an unresolved Generation persistence operation",
    );
  }
  if (
    current.generationLeaseId &&
    current.generationLeaseState !== "persisting" &&
    current.generationLeaseExpiresAt &&
    current.generationLeaseExpiresAt > now
  ) {
    throw new AppError(
      409,
      "SIGNAL_GENERATION_IN_PROGRESS",
      "This Signal is currently being used to generate drafts",
    );
  }

  const updated = await repository.updateSignalIfEditable(ownerId, signalId, input, now);
  if (updated) return toPublicSignalDto(updated);

  const latest = await repository.findSignalByIdAndOwner(ownerId, signalId);
  if (!latest) {
    throw new AppError(404, "SIGNAL_NOT_FOUND", "Signal not found");
  }
  if (await repository.findGenerationByOwnerAndSignal(ownerId, signalId)) {
    throw new AppError(409, "SIGNAL_GENERATION_EXISTS", "This Signal cannot be edited after generation");
  }
  if (
    latest.generationLeaseId &&
    latest.generationLeaseState === "persisting"
  ) {
    throw new AppError(
      409,
      "SIGNAL_GENERATION_IN_PROGRESS",
      "This Signal has an unresolved Generation persistence operation",
    );
  }
  if (
    latest.generationLeaseId &&
    latest.generationLeaseState !== "persisting" &&
    latest.generationLeaseExpiresAt &&
    latest.generationLeaseExpiresAt > now
  ) {
    throw new AppError(
      409,
      "SIGNAL_GENERATION_IN_PROGRESS",
      "This Signal is currently being used to generate drafts",
    );
  }
  throw new AppError(409, "SIGNAL_VERSION_CONFLICT", "The Signal changed before it could be saved");
}

export async function listSignalsForUser(
  ownerId: string,
  query: ListSignalsQuery,
): Promise<SignalListResult> {
  const [signals, total] = await Promise.all([
    findSignalsByOwner(ownerId, query),
    countSignalsByOwner(ownerId),
  ]);

  return {
    signals: signals.map(toPublicSignalDto),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
}
