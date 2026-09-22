import { z } from "zod";

export const linkedinPublicationPreviewSchema = z.object({
  signalId: z.string().regex(/^[a-f\d]{24}$/i),
  variationId: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();

export const linkedinPublicationConfirmSchema = z.object({
  previewId: z.string().uuid(),
}).strict();

const scheduleFields = z.object({
  previewId: z.string().uuid(),
  localDateTime: z.string(),
  timezone: z.string().min(1).max(100),
  disambiguation: z.enum(["earlier", "later"]).optional(),
}).strict();

export const linkedinPublicationScheduleSchema = scheduleFields;
export const linkedinPublicationRescheduleSchema = scheduleFields.extend({
  expectedRevision: z.number().int().nonnegative(),
});
export const linkedinPublicationCancelSchema = z.object({
  previewId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
