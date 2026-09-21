import { z } from "zod";

export const topicPlanningRequestSchema = z.object({
  requestId: z.string().trim().min(16).max(100),
  sourceIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(5),
  audience: z.string().trim().max(500).default(""),
  contentGoal: z.string().trim().max(500).default(""),
}).strict();

export const topicConversionSchema = z.object({
  suggestionId: z.string().min(1).max(100),
  topic: z.string().trim().min(5).max(120),
  notes: z.string().trim().min(30).max(4000),
  primaryAudience: z.enum(["Recruiters & hiring teams", "Developers & engineers", "Founders & product teams", "AI community"]),
  contentType: z.enum(["Project update", "Learning", "Technical insight", "Build in public"]),
}).strict();

export const topicPlansQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(20).default(10),
}).strict();

export type TopicPlanningRequest = z.infer<typeof topicPlanningRequestSchema>;
export type TopicConversionInput = z.infer<typeof topicConversionSchema>;
