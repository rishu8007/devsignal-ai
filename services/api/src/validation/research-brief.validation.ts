import { z } from "zod";

export const researchBriefRequestSchema = z.object({
  requestId: z.string().trim().min(16).max(100),
  sourceIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(5),
}).strict();
export const researchBriefQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(20).default(10),
}).strict();
export type ResearchBriefRequest = z.infer<typeof researchBriefRequestSchema>;
