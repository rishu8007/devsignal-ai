import {
  countSignalsByOwner,
  createSignal,
  findSignalsByOwner,
} from "../repositories/signal.repository.js";
import type { SignalDocument } from "../models/signal.model.js";
import type {
  SignalContentType,
  SignalPrimaryAudience,
} from "../constants/signal.constants.js";
import type { CreateSignalInput, ListSignalsQuery } from "../validation/signal.validation.js";

export interface PublicSignalDto {
  id: string;
  topic: string;
  notes: string;
  primaryAudience: SignalPrimaryAudience;
  contentType: SignalContentType;
  createdAt: Date;
  updatedAt: Date;
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
  };
}

export async function createSignalForUser(
  ownerId: string,
  input: CreateSignalInput,
): Promise<PublicSignalDto> {
  return toPublicSignalDto(await createSignal(ownerId, input));
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
