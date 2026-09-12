import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { listCalendarForUser } from "../services/calendar.service.js";
import type { CalendarQuery } from "../validation/calendar.validation.js";

export async function listCalendar(request: Request, response: Response): Promise<void> {
  const ownerId = request.auth?.userId;
  if (!ownerId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }
  const query = response.locals.calendarQuery as CalendarQuery;
  const result = await listCalendarForUser(
    ownerId,
    new Date(query.from),
    new Date(query.to),
    query.page,
    query.limit,
  );
  response.status(200).json({ success: true, data: result });
}
