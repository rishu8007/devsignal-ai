import { z } from "zod";

const id = z.string().regex(/^[a-f\d]{24}$/i);
export const reviewParamsSchema = z.object({ signalId: id, variationId: id }).strict();
export const reviewDetailParamsSchema = reviewParamsSchema.extend({ reviewId: id });
export const createReviewSchema = z.object({
  requestId: z.string().trim().min(1).max(100),
  researchBriefId: id,
}).strict();
export const applyReviewSchema = z.object({
  expectedContentHash: z.string().regex(/^[a-f\d]{64}$/i),
  content: z.string().trim().min(100).max(3000),
}).strict();
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type ApplyReviewInput = z.infer<typeof applyReviewSchema>;
