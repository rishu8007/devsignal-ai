import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import { listCalendarByOwner } from "../repositories/generation.repository.js";
import type { CalendarResult } from "../types/calendar.js";

export interface CalendarRepositoryBoundary {
  listCalendarByOwner: typeof listCalendarByOwner;
}

const defaultRepository: CalendarRepositoryBoundary = { listCalendarByOwner };

export async function listCalendarForUser(
  ownerId: string,
  from: Date,
  to: Date,
  page: number,
  limit: number,
  repository: CalendarRepositoryBoundary = defaultRepository,
): Promise<CalendarResult> {
  if (!Types.ObjectId.isValid(ownerId)) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }
  const result = await repository.listCalendarByOwner(ownerId, from, to, page, limit);
  return {
    items: result.items,
    pagination: {
      page,
      limit,
      total: result.total,
      totalPages: result.total === 0 ? 0 : Math.ceil(result.total / limit),
    },
  };
}
