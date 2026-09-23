import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  ensureUsageIndexes,
  reserveUsage,
  transitionUsage,
  usageSummary,
} from "../repositories/usage.repository.js";

export type AiOperationType = "generation" | "topic_planning" | "research" | "draft_review" | "indexing" | "retrieval";
export interface UsageRepositoryBoundary {
  reserveUsage: typeof reserveUsage;
  transitionUsage: typeof transitionUsage;
  usageSummary: typeof usageSummary;
}
const defaultUsageRepository: UsageRepositoryBoundary = { reserveUsage, transitionUsage, usageSummary };
export interface ProviderUsage {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  embeddingTokens: number | null;
}
export type ProviderUsageLike = { model: string; inputTokens?: number | null | undefined; outputTokens?: number | null | undefined; embeddingTokens?: number | null | undefined };
export function aggregateProviderUsage(value: ProviderUsageLike | ProviderUsageLike[] | null | undefined): ProviderUsage | undefined {
  if (!value) return undefined;
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0) return undefined;
  const first = entries[0];
  if (!first) return undefined;
  return {
    model: entries.length === 1 ? first.model : entries.map((entry) => entry.model).join(","),
    inputTokens: sumUsage(entries, "inputTokens"),
    outputTokens: sumUsage(entries, "outputTokens"),
    embeddingTokens: sumUsage(entries, "embeddingTokens"),
  };
}
function sumUsage(entries: ProviderUsageLike[], key: keyof ProviderUsage): number | null {
  const values = entries.map((entry) => entry[key]).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}
const pricingSchema = z.object({
  model: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  effectiveDate: z.string().datetime(),
  inputPerMillionTokens: z.number().nonnegative(),
  outputPerMillionTokens: z.number().nonnegative(),
  embeddingPerMillionTokens: z.number().nonnegative(),
}).strict();
const pricingConfigSchema = z.array(pricingSchema).max(100);
export function quotaWindow(now = new Date()) { const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); return { start, resetAt: new Date(start.getTime() + 86400000) }; }
export async function admitAiOperation(ownerId: string, operationKey: string, operationType: AiOperationType, now = new Date(), repository: UsageRepositoryBoundary = defaultUsageRepository) {
  if (!Types.ObjectId.isValid(ownerId)) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  const { start } = quotaWindow(now);
  try {
    const result = await repository.reserveUsage(ownerId, start, operationKey, operationType, env.AI_DAILY_OPERATION_LIMIT, env.AI_APPLICATION_DAILY_OPERATION_LIMIT, now);
    if (!result) throw new AppError(429, "AI_QUOTA_EXCEEDED", "AI usage limit reached; try again after the quota resets");
    return { id: result.reservation._id.toString(), duplicate: result.duplicate, windowStart: start };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (env.AI_USAGE_FAIL_CLOSED) throw new AppError(503, "AI_QUOTA_UNAVAILABLE", "AI usage controls are temporarily unavailable");
    throw error;
  }
}
export async function markAiDispatched(id: string, now = new Date(), repository: UsageRepositoryBoundary = defaultUsageRepository) {
  const result = await repository.transitionUsage(id, "reserved", "dispatched", undefined, now);
  if (!result) {
    await repository.transitionUsage(id, "reserved", "released", undefined, now);
    throw new AppError(409, "AI_OPERATION_EXPIRED", "The AI operation reservation expired");
  }
  return result;
}
export const completeAiOperation = (id: string, usage?: Parameters<typeof transitionUsage>[3], repository: UsageRepositoryBoundary = defaultUsageRepository) => repository.transitionUsage(
  id,
  "dispatched",
  "completed",
  usage ? { ...usage, pricingBasis: usage.model && env.AI_MODEL_PRICING_JSON ? pricingForModel(usage.model) : null } : undefined,
);
export const releaseAiOperation = (id: string, repository: UsageRepositoryBoundary = defaultUsageRepository) => repository.transitionUsage(id, "reserved", "released");
export const markAiUncertain = (id: string, repository: UsageRepositoryBoundary = defaultUsageRepository) => repository.transitionUsage(id, "dispatched", "uncertain");
export async function getUsageForUser(ownerId: string, now = new Date(), repository: UsageRepositoryBoundary = defaultUsageRepository) {
  const { start, resetAt } = quotaWindow(now);
  const [window, reservations] = await repository.usageSummary(ownerId, start);
  const used = reservations.filter((item) => ["completed", "dispatched", "uncertain"].includes(item.status)).length;
  const reserved = reservations.filter((item) => item.status === "reserved").length;
  const pricing = parsePricing();
  const known = reservations.filter((item) => item.inputTokens != null || item.outputTokens != null || item.embeddingTokens != null);
  const byOperation = new Map<string, Array<Record<string, unknown>>>();
  for (const item of reservations) {
    const bucket = byOperation.get(item.operationType) ?? [];
    bucket.push(item as Record<string, unknown>);
    byOperation.set(item.operationType, bucket);
  }
  return { windowStart: start, resetAt, limit: env.AI_DAILY_OPERATION_LIMIT, used, reserved, remaining: Math.max(0, env.AI_DAILY_OPERATION_LIMIT - used - reserved), knownUsageRecords: known.length, missingUsageRecords: reservations.length - known.length, operations: Object.fromEntries([...byOperation.entries()].map(([key, value]) => [key, { count: value.length, inputTokens: sum(value, "inputTokens"), outputTokens: sum(value, "outputTokens"), embeddingTokens: sum(value, "embeddingTokens") }])), estimatedCost: pricing ? estimate(reservations as Array<Record<string, unknown>>, pricing) : null, pricingConfigured: Boolean(pricing) };
}
function sum(items: Array<Record<string, unknown>>, key: string) { const values = items.map((item) => item[key]).filter((value): value is number => typeof value === "number"); return values.length ? values.reduce((a, b) => a + b, 0) : null; }
function parsePricing() {
  if (!env.AI_MODEL_PRICING_JSON) return [];
  const parsed: unknown = JSON.parse(env.AI_MODEL_PRICING_JSON);
  return pricingConfigSchema.parse(parsed);
}
function pricingForModel(model: string) {
  return parsePricing().filter((entry) => entry.model === model).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null;
}
function estimate(items: Array<Record<string, unknown>>, pricing: z.infer<typeof pricingConfigSchema>) {
  let amount = 0;
  let known = false;
  let partial = false;
  const currencies = new Set<string>();
  for (const item of items) {
    const entry = pricing
      .filter((candidate) => candidate.model === item.model)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
    if (!entry) {
      partial = true;
      continue;
    }
    currencies.add(entry.currency);
    const values = [
      [item.inputTokens, entry.inputPerMillionTokens],
      [item.outputTokens, entry.outputPerMillionTokens],
      [item.embeddingTokens, entry.embeddingPerMillionTokens],
    ] as const;
    let itemKnown = false;
    for (const [tokens, rate] of values) {
      if (typeof tokens === "number") {
        amount += (tokens / 1_000_000) * rate;
        itemKnown = true;
      } else {
        partial = true;
      }
    }
    known ||= itemKnown;
  }
  if (!known || currencies.size !== 1) return null;
  return { currency: [...currencies][0], amount, label: partial ? "Estimated (partial)" : "Estimated" };
}
export { ensureUsageIndexes };
