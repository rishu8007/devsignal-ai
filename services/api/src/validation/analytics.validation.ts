import { z } from "zod";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timezoneSchema = z.string().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "Timezone must be a valid IANA timezone");

export const analyticsQuerySchema = z.object({
  preset: z.enum(["7d", "30d", "custom"]).default("30d"),
  from: z.string().regex(datePattern).optional(),
  to: z.string().regex(datePattern).optional(),
  timezone: timezoneSchema.default("UTC"),
  page: z.coerce.number().int().positive().max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict().superRefine((value, context) => {
  if (value.preset === "custom" && (!value.from || !value.to)) {
    context.addIssue({ code: "custom", path: ["from"], message: "Custom ranges require from and to" });
  }
  if (value.preset !== "custom" && (value.from || value.to)) {
    context.addIssue({ code: "custom", path: ["from"], message: "from and to are only valid for custom ranges" });
  }
  for (const field of ["from", "to"] as const) {
    const valueForField = value[field];
    if (valueForField && Number.isNaN(Date.parse(`${valueForField}T00:00:00Z`))) {
      context.addIssue({ code: "custom", path: [field], message: "Date must be valid" });
    }
  }
});

const nullableCount = z.number().int().min(0).nullable();
export const engagementCreateSchema = z.object({
  publicationId: z.string().uuid(),
  impressions: nullableCount,
  reactions: nullableCount,
  comments: nullableCount,
  reposts: nullableCount,
  observedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value), "Observation time must include an explicit timezone"),
}).strict();

export const engagementUpdateSchema = engagementCreateSchema.omit({ publicationId: true }).extend({
  expectedRevision: z.number().int().positive(),
}).strict();

export const engagementParamsSchema = z.object({ snapshotId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
export const engagementDeleteSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type EngagementCreateInput = z.infer<typeof engagementCreateSchema>;
export type EngagementUpdateInput = z.infer<typeof engagementUpdateSchema>;
