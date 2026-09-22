import { request } from "@/lib/api/api-client";

export type Engagement = {
  id: string;
  publicationId: string;
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  observedAt: string;
  revision: number;
  label: "Manually entered";
};

export type AnalyticsPost = {
  publicationId: string;
  topic: string;
  publishedAt: string;
  text: string;
  engagement: Engagement | null;
};

export type AnalyticsResponse = {
  range: { from: string; to: string; timezone: string; startDate: string; endDate: string };
  activity: Record<string, number>;
  topics: Array<{
    topic: string;
    publications: number;
    engagementPosts: number;
    impressions: number;
    reactions: number;
    comments: number;
    reposts: number;
    rateNumerator: number;
    rateDenominator: number;
    rateEligiblePosts: number;
    engagementRate: number | null;
    engagementRateEligiblePosts: number;
    engagementRateFormula: string;
  }>;
  reviewInsights: { population: number; severities: Record<string, number>; categories: Record<string, number> };
  posts: AnalyticsPost[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAnalyticsResponse(value: unknown): value is { success: true; data: AnalyticsResponse } {
  return isRecord(value) && value.success === true && isRecord(value.data) && "activity" in value.data && "topics" in value.data && "posts" in value.data;
}

export function getAnalytics(query: { preset: "7d" | "30d" | "custom"; from?: string; to?: string; timezone: string; page?: number; limit?: number }, signal?: AbortSignal) {
  const params = new URLSearchParams({ preset: query.preset, timezone: query.timezone, page: String(query.page ?? 1), limit: String(query.limit ?? 20) });
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return request(`/analytics?${params.toString()}`, { method: "GET", signal }, isAnalyticsResponse).then((value) => value.data);
}

export function createEngagement(input: { publicationId: string; impressions: number | null; reactions: number | null; comments: number | null; reposts: number | null; observedAt: string }) {
  return request("/analytics/engagement", { method: "POST", body: JSON.stringify(input) }, (value): value is { success: true; data: { snapshot: Engagement } } => isRecord(value) && value.success === true && isRecord(value.data) && isRecord(value.data.snapshot)).then((value) => value.data.snapshot);
}

export function updateEngagement(id: string, input: Omit<Parameters<typeof createEngagement>[0], "publicationId"> & { expectedRevision: number }) {
  return request(`/analytics/engagement/${id}`, { method: "PATCH", body: JSON.stringify(input) }, (value): value is { success: true; data: { snapshot: Engagement } } => isRecord(value) && value.success === true && isRecord(value.data) && isRecord(value.data.snapshot)).then((value) => value.data.snapshot);
}

export function deleteEngagement(id: string, expectedRevision: number) {
  return request(`/analytics/engagement/${id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision }) }, (value): value is { success: true } => isRecord(value) && value.success === true).then(() => undefined);
}
