import { z } from "zod";

const retrievalCandidateSchema = z
  .object({
    pointId: z.string().min(1),
    ownerId: z.string().regex(/^[a-f\d]{24}$/i),
    sourceId: z.string().regex(/^[a-f\d]{24}$/i),
    contentVersion: z.number().int().positive(),
    chunkerVersion: z.string().min(1),
    chunkIndex: z.number().int().nonnegative(),
    chunkId: z.string().min(1),
    text: z.string().min(1),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    embeddingModel: z.string().min(1),
    score: z.number().finite(),
  })
  .strict();

export const aiRetrievalResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(retrievalCandidateSchema),
  })
  .strict();

export const aiRetrievalErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
  .strict();

export type AiRetrievalCandidate = z.infer<typeof retrievalCandidateSchema>;
