import { request } from "./api-client";
export interface UsageSummary {
  resetAt: string;
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  knownUsageRecords: number;
  missingUsageRecords: number;
  operations: Record<string, { count: number; inputTokens: number | null; outputTokens: number | null; embeddingTokens: number | null }>;
  estimatedCost: { currency: string; amount: number; label: string } | null;
  pricingConfigured: boolean;
}
export function getUsage(signal?: AbortSignal) {
  return request<{ success: true; data: UsageSummary }>("/usage", { method: "GET", signal }, (value): value is { success: true; data: UsageSummary } => {
    return typeof value === "object" && value !== null && "success" in value && value.success === true && "data" in value;
  }).then((response) => response.data);
}
