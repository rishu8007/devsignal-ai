import type { ListSignalsQuery } from "../validation/signal.validation.js";
import type { ListDraftsQuery } from "../validation/draft.validation.js";
import type { CalendarQuery } from "../validation/calendar.validation.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
      };
    }

    interface Locals {
      signalQuery: ListSignalsQuery;
      signalId: string;
      variationId: string;
      draftQuery: ListDraftsQuery;
      calendarQuery: CalendarQuery;
    }
  }
}

export {};
