import { z } from "zod";

export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const notificationIdSchema = z.object({ notificationId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();

export const notificationReadDisplayedSchema = z.object({
  notificationIds: z.array(z.string().regex(/^[a-f\d]{24}$/i))
    .min(1)
    .transform((ids) => [...new Set(ids)])
    .refine((ids) => ids.length <= 50, "At most 50 notification ids are allowed."),
}).strict();
