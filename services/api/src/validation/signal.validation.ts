import { z } from "zod";
import {
  SIGNAL_CONTENT_TYPES,
  SIGNAL_NOTES_MAX_LENGTH,
  SIGNAL_NOTES_MIN_LENGTH,
  SIGNAL_PRIMARY_AUDIENCES,
  SIGNAL_TOPIC_MAX_LENGTH,
  SIGNAL_TOPIC_MIN_LENGTH,
} from "../constants/signal.constants.js";

export const createSignalSchema = z
  .object({
    topic: z
      .string()
      .trim()
      .min(SIGNAL_TOPIC_MIN_LENGTH, "Topic must contain at least 5 characters")
      .max(SIGNAL_TOPIC_MAX_LENGTH, "Topic must contain at most 120 characters"),
    notes: z
      .string()
      .trim()
      .min(SIGNAL_NOTES_MIN_LENGTH, "Notes must contain at least 30 characters")
      .max(SIGNAL_NOTES_MAX_LENGTH, "Notes must contain at most 4000 characters"),
    primaryAudience: z.enum(SIGNAL_PRIMARY_AUDIENCES, {
      error: "Choose a valid primary audience",
    }),
    contentType: z.enum(SIGNAL_CONTENT_TYPES, {
      error: "Choose a valid content type",
    }),
  })
  .strict();

export type CreateSignalInput = z.infer<typeof createSignalSchema>;

export const listSignalsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive("Page must be a positive integer").default(1),
    limit: z.coerce
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(50, "Limit must be at most 50")
      .default(20),
  })
  .strict();

export type ListSignalsQuery = z.infer<typeof listSignalsQuerySchema>;
