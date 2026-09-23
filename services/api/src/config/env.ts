import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
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
  AI_DAILY_OPERATION_LIMIT: z.coerce.number().int().min(1).max(100000).default(100),
  AI_APPLICATION_DAILY_OPERATION_LIMIT: z.coerce.number().int().min(1).max(1000000).default(10000),
  AI_USAGE_FAIL_CLOSED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  AI_MODEL_PRICING_JSON: z.string().default(""),
  LINKEDIN_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  LINKEDIN_CLIENT_ID: z.string().trim().min(1).optional(),
  LINKEDIN_CLIENT_SECRET: z.string().min(1).optional(),
  LINKEDIN_REDIRECT_URI: z.string().url().optional(),
  LINKEDIN_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  LINKEDIN_SCOPES: z.string().default("openid profile email"),
  LINKEDIN_POSTING_SCOPES: z.string().default("openid profile email w_member_social"),
  LINKEDIN_API_VERSION: z.string().regex(/^\d{6}$/).default("202601"),
  LINKEDIN_PUBLISHING_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  LINKEDIN_SCHEDULER_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  LINKEDIN_SCHEDULE_HORIZON_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  LINKEDIN_SCHEDULE_LATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  GITHUB_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  GITHUB_APP_CLIENT_ID: z.string().trim().min(1).optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_APP_ID: z.coerce.number().int().positive().optional(),
  GITHUB_APP_SLUG: z.string().trim().regex(/^[A-Za-z0-9-]+$/).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_REDIRECT_URI: z.string().url().optional(),
  GITHUB_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GITHUB_SYNC_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  GITHUB_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  GITHUB_SYNC_MAX_PAGES_PER_PASS: z.coerce.number().int().min(1).max(100).default(3),
  GITHUB_INITIAL_HISTORY_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
});
const pricingConfigSchema = z.array(z.object({
  model: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  effectiveDate: z.string().datetime(),
  inputPerMillionTokens: z.number().nonnegative(),
  outputPerMillionTokens: z.number().nonnegative(),
  embeddingPerMillionTokens: z.number().nonnegative(),
}).strict()).max(100);

// Compose uses empty defaults for optional provider settings. Treat only an
// exact empty value as absent; preserve whitespace and private-key contents.
const normalizedEnvironment = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value === "" ? undefined : value]),
);

const parsedEnvironment = environmentSchema.safeParse(normalizedEnvironment);

if (!parsedEnvironment.success) {
  const invalidKeys = [
    ...new Set(parsedEnvironment.error.issues.map((issue) => issue.path.join("."))),
  ];
  console.error(`Invalid environment configuration: ${invalidKeys.join(", ")}`);
  throw new Error("Environment configuration is invalid.");
}

export const env = parsedEnvironment.data;

if (env.AI_MODEL_PRICING_JSON) {
  const pricing = (() => {
    try { return JSON.parse(env.AI_MODEL_PRICING_JSON) as unknown; } catch { return null; }
  })();
  if (!pricingConfigSchema.safeParse(pricing).success) {
    throw new Error("AI_MODEL_PRICING_JSON is invalid.");
  }
}

const linkedinPartiallyConfigured = Boolean(
  env.LINKEDIN_CLIENT_ID || env.LINKEDIN_CLIENT_SECRET || env.LINKEDIN_TOKEN_ENCRYPTION_KEY,
);

if (env.LINKEDIN_ENABLED || linkedinPartiallyConfigured) {
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET || !env.LINKEDIN_REDIRECT_URI) {
    throw new Error("LinkedIn configuration is incomplete.");
  }
  if (!env.LINKEDIN_TOKEN_ENCRYPTION_KEY) {
    throw new Error("LINKEDIN_TOKEN_ENCRYPTION_KEY is required when LinkedIn is enabled.");
  }
  const key = Buffer.from(env.LINKEDIN_TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("LINKEDIN_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
}

const githubPartiallyConfigured = Boolean(
  env.GITHUB_APP_CLIENT_ID
  || env.GITHUB_APP_CLIENT_SECRET
  || env.GITHUB_APP_ID
  || env.GITHUB_APP_SLUG
  || env.GITHUB_APP_PRIVATE_KEY
  || env.GITHUB_TOKEN_ENCRYPTION_KEY,
);

if (env.GITHUB_ENABLED || githubPartiallyConfigured) {
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET || !env.GITHUB_APP_ID || !env.GITHUB_APP_SLUG || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_REDIRECT_URI) {
    throw new Error("GitHub configuration is incomplete.");
  }
  if (!env.GITHUB_TOKEN_ENCRYPTION_KEY || Buffer.from(env.GITHUB_TOKEN_ENCRYPTION_KEY, "base64").length !== 32) {
    throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
}
