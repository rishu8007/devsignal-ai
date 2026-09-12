import { z } from "zod";

const explicitTimezoneTimestamp = z
  .string()
  .refine((value) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value), "Timestamp must include an explicit timezone")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Timestamp must be valid");

export const calendarQuerySchema = z
  .object({
    from: explicitTimezoneTimestamp,
    to: explicitTimezoneTimestamp,
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .superRefine((query, context) => {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    if (from >= to) {
      context.addIssue({ code: "custom", path: ["to"], message: "To must be after from" });
    }
    if (to - from > 93 * 24 * 60 * 60 * 1000) {
      context.addIssue({ code: "custom", path: ["to"], message: "Date range must not exceed 93 days" });
    }
  });

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
