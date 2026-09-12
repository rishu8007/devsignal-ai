import { z } from "zod";
import { GENERATION_ANGLES } from "../types/generation.js";

export const signalGenerationParamsSchema = z
  .object({
    signalId: z.string().regex(/^[a-f\d]{24}$/i, "Signal ID must be a valid identifier"),
  })
  .strict();

export const generationVariationParamsSchema = signalGenerationParamsSchema.extend({
  variationId: z.string().regex(/^[a-f\d]{24}$/i, "Variation ID must be a valid identifier"),
});

export const generationQuerySchema = z.object({}).strict();

export const generationRequestSchema = z.union([z.undefined(), z.object({}).strict()]);

export const editGenerationVariationSchema = z
  .object({
    content: z.string().trim().min(100).max(3000),
  })
  .strict();

export const approveGenerationVariationSchema = z.object({}).strict();

const explicitTimezoneTimestamp = z
  .string()
  .refine((value) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value), "Timestamp must include an explicit timezone")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Timestamp must be valid");

export const scheduleGenerationVariationSchema = z
  .object({ scheduledFor: explicitTimezoneTimestamp })
  .strict();

export type EditGenerationVariationInput = z.infer<typeof editGenerationVariationSchema>;
export type ScheduleGenerationVariationInput = z.infer<
  typeof scheduleGenerationVariationSchema
>;

export const aiGenerationResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      model: z.string().trim().min(1),
      variations: z
        .array(
          z.object({
            angle: z.enum(GENERATION_ANGLES),
            content: z.string(),
          }).strict(),
        )
        .length(3),
    }).strict(),
  })
  .strict();

export const aiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
  }),
});
