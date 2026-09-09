import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
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
