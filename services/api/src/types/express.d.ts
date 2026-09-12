import type { ListSignalsQuery } from "../validation/signal.validation.js";
import type { ListDraftsQuery } from "../validation/draft.validation.js";
import type { CalendarQuery } from "../validation/calendar.validation.js";
import type {
  KnowledgeSourceParams,
  ListKnowledgeSourcesQuery,
} from "../validation/knowledge-source.validation.js";

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
      knowledgeSourceParams: KnowledgeSourceParams;
      knowledgeSourceQuery: ListKnowledgeSourcesQuery;
    }
  }
}

export {};
