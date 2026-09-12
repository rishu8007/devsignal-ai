import { z } from "zod";

export const aiIndexingResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    sourceId: z.string().regex(/^[a-f\d]{24}$/i),
    contentVersion: z.number().int().positive(),
    chunkerVersion: z.string().min(1),
    embeddingModel: z.string().min(1),
    dimensions: z.number().int().positive(),
    indexedChunkCount: z.number().int().positive(),
  }).strict(),
}).strict();

export const aiIndexingErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).strict(),
}).strict();

export type AiIndexingResult = z.infer<typeof aiIndexingResponseSchema>["data"];
