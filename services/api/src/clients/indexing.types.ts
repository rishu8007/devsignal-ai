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
  usage: z.union([z.object({
    model: z.string().min(1),
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    embeddingTokens: z.number().int().nonnegative().nullable().optional(),
  }).strict(), z.array(z.object({
    model: z.string().min(1),
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    embeddingTokens: z.number().int().nonnegative().nullable().optional(),
  }).strict())]).nullable().optional(),
}).strict();

export const aiIndexingErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).strict(),
}).strict();

export type AiIndexingResult = z.infer<typeof aiIndexingResponseSchema>["data"] & {
  usage?: z.infer<typeof aiIndexingResponseSchema>["usage"];
};
