import type { ListSignalsQuery } from "../validation/signal.validation.js";
import type { ListDraftsQuery } from "../validation/draft.validation.js";
import type { CalendarQuery } from "../validation/calendar.validation.js";
import type {
  KnowledgeSourceParams,
  ListKnowledgeSourcesQuery,
} from "../validation/knowledge-source.validation.js";
import type { z } from "zod";
import type { topicPlansQuerySchema } from "../validation/topic-planning.validation.js";
import type { AnalyticsQuery } from "../validation/analytics.validation.js";

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
      workflowId: string;
      draftQuery: ListDraftsQuery;
      calendarQuery: CalendarQuery;
      knowledgeSourceParams: KnowledgeSourceParams;
      knowledgeSourceQuery: ListKnowledgeSourcesQuery;
      topicPlansQuery: z.infer<typeof topicPlansQuerySchema>;
      researchQuery: z.infer<typeof import("../validation/research-brief.validation.js").researchBriefQuerySchema>;
      notificationQuery: z.infer<typeof import("../validation/notification.validation.js").notificationQuerySchema>;
      analyticsQuery: AnalyticsQuery;
      snapshotId: string;
    }
  }
}

export {};
