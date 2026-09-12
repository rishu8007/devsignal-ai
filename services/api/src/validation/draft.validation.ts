import { z } from "zod";

export const listDraftsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive("Page must be a positive integer").default(1),
    limit: z.coerce
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(50, "Limit must be at most 50")
      .default(20),
    status: z.enum(["draft", "approved"]).optional(),
  })
  .strict();

export type ListDraftsQuery = z.infer<typeof listDraftsQuerySchema>;
