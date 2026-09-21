import { request } from "@/lib/api/api-client";
import type { PublicGeneration } from "@/lib/api/generation-client";

export interface DraftReview {
  id: string;
  signalId: string;
  variationId: string;
  researchBriefId: string;
  draftContent: string;
  draftContentHash: string;
  summary: string;
  findings: Array<{ category: string; severity: string; passage: string; explanation: string; evidenceIds: string[]; suggestion: string }>;
  proposedDraft: string | null;
  status: string;
  stale: boolean;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
const reviewEnvelope = (value: unknown): value is { success: true; data: { review: DraftReview } } =>
  Boolean(value && typeof value === "object" && (value as { success?: unknown }).success === true && (value as { data?: { review?: unknown } }).data?.review);
export function createDraftReview(signalId: string, variationId: string, input: { requestId: string; researchBriefId: string }) {
  return request(`/signals/${signalId}/generations/${variationId}/reviews`, { method: "POST", body: JSON.stringify(input), timeoutMs: 160_000 }, reviewEnvelope).then((value) => value.data.review);
}
export function listDraftReviews(signalId: string, variationId: string) {
  return request(`/signals/${signalId}/generations/${variationId}/reviews`, { method: "GET" }, (value): value is { success: true; data: { reviews: DraftReview[] } } => Boolean(value && typeof value === "object" && (value as { success?: unknown }).success === true && Array.isArray((value as { data?: { reviews?: unknown } }).data?.reviews))).then((value) => value.data.reviews);
}
export function applyDraftReview(signalId: string, variationId: string, reviewId: string, input: { expectedContentHash: string; content: string }) {
  return request(`/signals/${signalId}/generations/${variationId}/reviews/${reviewId}/apply`, { method: "POST", body: JSON.stringify(input), timeoutMs: 160_000 }, (value): value is { success: true; data: { generation: PublicGeneration } } => Boolean(value && typeof value === "object" && (value as { success?: unknown }).success === true)).then((value) => value.data.generation);
}
