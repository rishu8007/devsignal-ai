import { z } from "zod";

export const knowledgeSourceSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    limit: z.number().int().min(1).max(20).default(5),
  })
  .strict();

export type KnowledgeSourceSearchInput = z.infer<typeof knowledgeSourceSearchSchema>;
