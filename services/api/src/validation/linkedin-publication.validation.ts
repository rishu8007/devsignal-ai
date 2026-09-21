import { z } from "zod";

export const linkedinPublicationPreviewSchema = z.object({
  signalId: z.string().regex(/^[a-f\d]{24}$/i),
  variationId: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();

export const linkedinPublicationConfirmSchema = z.object({
  previewId: z.string().uuid(),
}).strict();
