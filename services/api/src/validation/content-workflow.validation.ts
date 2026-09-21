import { z } from "zod";

const id = z.string().regex(/^[a-f\d]{24}$/i);
export const workflowSignalParamsSchema = z.object({ signalId: id }).strict();
export const workflowDetailParamsSchema = z.object({ signalId: id, workflowId: id }).strict();
export const startWorkflowSchema = z.object({
  requestId: z.string().trim().min(1).max(100),
  sourceIds: z.array(id).min(1).max(5),
}).strict();
export const approvalSchema = z.object({
  variationId: id,
  draftHash: z.string().regex(/^[a-f\d]{64}$/i),
}).strict();
export type StartWorkflowInput = z.infer<typeof startWorkflowSchema>;
export type ApprovalInput = z.infer<typeof approvalSchema>;
