import { Router } from "express";
import { listCalendar } from "../controllers/calendar.controller.js";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateQuery } from "../middleware/validate-request.middleware.js";
import { calendarQuerySchema, type CalendarQuery } from "../validation/calendar.validation.js";

export const calendarRouter = Router();

calendarRouter.get(
  "/",
  authenticationMiddleware,
  validateQuery(calendarQuerySchema, (locals, query: CalendarQuery) => {
    locals.calendarQuery = query;
  }),
  listCalendar,
);
