import { z } from "zod";

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must contain at least 2 characters")
      .max(80, "Name must contain at most 80 characters"),
    email: z
      .string()
      .trim()
      .max(254, "Email address must contain at most 254 characters")
      .email("Enter a valid email address"),
    password: z
      .string()
      .refine(
        (password) => password.length >= 10,
        "Password must contain at least 10 characters",
      )
      .refine(
        (password) => Buffer.byteLength(password, "utf8") <= 72,
        "Password must not exceed 72 UTF-8 bytes",
      ),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(254, "Email address must contain at most 254 characters")
      .email("Enter a valid email address")
      .transform((email) => email.toLowerCase()),
    password: z.string().min(1, "Password is required").refine(
      (password) => Buffer.byteLength(password, "utf8") <= 72,
      "Password must not exceed 72 UTF-8 bytes",
    ),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
