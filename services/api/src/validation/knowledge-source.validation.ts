import { z } from "zod";

export const createKnowledgeSourceSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title must contain at least 1 character")
      .max(120, "Title must contain at most 120 characters"),
    content: z
      .string()
      .trim()
      .min(10, "Content must contain at least 10 characters")
      .max(20_000, "Content must contain at most 20000 characters"),
  })
  .strict();

export const listKnowledgeSourcesQuerySchema = z
  .object({
    page: z.coerce.number().int().positive("Page must be a positive integer").default(1),
    limit: z.coerce
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(50, "Limit must be at most 50")
      .default(20),
  })
  .strict();

export const knowledgeSourceParamsSchema = z
  .object({
    sourceId: z.string().regex(/^[a-f\d]{24}$/i, "Source ID must be a valid identifier"),
  })
  .strict();

export type CreateKnowledgeSourceInput = z.infer<typeof createKnowledgeSourceSchema>;
export type ListKnowledgeSourcesQuery = z.infer<typeof listKnowledgeSourcesQuerySchema>;
export type KnowledgeSourceParams = z.infer<typeof knowledgeSourceParamsSchema>;
