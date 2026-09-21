import { request } from "@/lib/api/api-client";
export type TopicSuggestion = { id: string; title: string; angle: string; relevance: string; talkingPoints: string[]; sourceIds: string[]; missingEvidence: string[] };
export type TopicPlan = { id: string; audience: string; contentGoal: string; stale: boolean; status: "running" | "succeeded" | "failed" | "uncertain"; errorCode?: string | null; sourceVersions: Array<{ sourceId: string; contentVersion: number }>; suggestions: TopicSuggestion[]; convertedSuggestionIds: string[]; createdAt: string; updatedAt: string };
export type TopicPlanStatus = "running" | "succeeded" | "failed" | "uncertain";
const isPlan = (value: unknown): value is { success: true; data: { run: TopicPlan } } => {
  if (!value || typeof value !== "object") return false;
  const envelope = value as { success?: unknown; data?: { run?: TopicPlan } };
  return envelope.success === true && Boolean(envelope.data?.run?.id) && Array.isArray(envelope.data?.run?.suggestions);
};
export function createTopicPlan(input: { requestId: string; sourceIds: string[]; audience: string; contentGoal: string }, signal?: AbortSignal) {
  return request("/topic-plans", { method: "POST", body: JSON.stringify(input), signal }, isPlan).then((value) => value.data.run);
}
function isPlanList(value: unknown): value is { success: true; data: { runs: TopicPlan[]; pagination: { page: number; limit: number; total: number; totalPages: number } } } {
  if (!value || typeof value !== "object") return false;
  const data = (value as { data?: { runs?: unknown; pagination?: unknown } }).data;
  return Boolean((value as { success?: unknown }).success === true && data && Array.isArray(data.runs) && data.pagination);
}
export function listTopicPlans(page = 1, limit = 10, signal?: AbortSignal) {
  return request(`/topic-plans?page=${page}&limit=${limit}`, { method: "GET", signal }, isPlanList).then((value) => value.data);
}
export function convertTopicSuggestion(runId: string, input: { suggestionId: string; topic: string; notes: string; primaryAudience: string; contentType: string }, signal?: AbortSignal) {
  return request(`/topic-plans/${encodeURIComponent(runId)}/convert`, { method: "POST", body: JSON.stringify(input), signal }, (value): value is { success: true; data: { signal: { id: string; topic: string }; duplicate: boolean } } => Boolean(value && typeof value === "object" && (value as { success?: unknown }).success === true)).then((value) => value.data);
}
