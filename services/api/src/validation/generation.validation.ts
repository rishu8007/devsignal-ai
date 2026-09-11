import { z } from "zod";
import { GENERATION_ANGLES } from "../types/generation.js";

export const signalGenerationParamsSchema = z.object({
  signalId: z.string().regex(/^[a-f\d]{24}$/i, "Signal ID must be a valid identifier"),
});

export const generationQuerySchema = z.object({}).strict();

export const generationRequestSchema = z.union([z.undefined(), z.object({}).strict()]);

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
