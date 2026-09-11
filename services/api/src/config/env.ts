import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  MONGODB_URI: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"),
      "MONGODB_URI must begin with mongodb:// or mongodb+srv://",
    ),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
  JWT_ISSUER: z.string().min(1).default("devsignal-api"),
  JWT_AUDIENCE: z.string().min(1).default("devsignal-web"),
  AUTH_COOKIE_NAME: z
    .string()
    .min(1)
    .regex(/^[\w!#$%&'*+\-.^`|~]+$/)
    .default("devsignal_access_token"),
  AI_SERVICE_URL: z
    .string()
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "AI_SERVICE_URL must use HTTP or HTTPS",
    })
    .default("http://127.0.0.1:8000"),
  AI_INTERNAL_API_KEY: z.string().min(32).optional(),
  AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(150000),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const invalidKeys = [
    ...new Set(parsedEnvironment.error.issues.map((issue) => issue.path.join("."))),
  ];
  console.error(`Invalid environment configuration: ${invalidKeys.join(", ")}`);
  throw new Error("Environment configuration is invalid.");
}

export const env = parsedEnvironment.data;
