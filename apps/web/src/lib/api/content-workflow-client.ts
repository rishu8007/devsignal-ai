import { request } from "@/lib/api/api-client";

export interface ContentWorkflow {
  id: string;
  signalId: string;
  status: string;
  phase: string;
  sourceVersions: Array<{ sourceId: string; contentVersion: number }>;
  researchBriefId: string | null;
  generationId: string | null;
  reviewIds: string[];
  reviewBindings: Array<{
    variationId: string;
    reviewId: string;
    draftContentHash: string;
    stale: boolean;
    status: string;
    summary: string;
    findings: unknown[];
    proposedDraft: string | null;
  }>;
  researchOutput: unknown;
  generationOutput: unknown;
  reviewOutput: unknown;
  approvedVariationId: string | null;
  errorCode: string | null;
  cancellationRequested: boolean;
  createdAt: string;
  updatedAt: string;
}
const workflow = (value: unknown): value is { success: true; data: { workflow: ContentWorkflow } } =>
  Boolean(value && typeof value === "object" && (value as { success?: unknown }).success === true && (value as { data?: { workflow?: unknown } }).data?.workflow);
export function startContentWorkflow(signalId: string, sourceIds: string[]) { return request(`/signals/${signalId}/workflows`, { method: "POST", body: JSON.stringify({ requestId: crypto.randomUUID(), sourceIds }), timeoutMs: 160_000 }, workflow).then((value) => value.data.workflow); }
export function getContentWorkflow(signalId: string, workflowId: string, signal?: AbortSignal) { return request(`/signals/${signalId}/workflows/${workflowId}`, { method: "GET", signal }, workflow).then((value) => value.data.workflow); }
export function listContentWorkflows(signalId: string) { return request(`/signals/${signalId}/workflows`, { method: "GET" }, (value): value is { success: true; data: { workflows: ContentWorkflow[] } } => Boolean(value && typeof value === "object" && (value as { success?: unknown }).success === true && Array.isArray((value as { data?: { workflows?: unknown } }).data?.workflows))).then((value) => value.data.workflows); }
export function cancelContentWorkflow(signalId: string, workflowId: string) { return request(`/signals/${signalId}/workflows/${workflowId}/cancel`, { method: "POST", body: "{}", }, workflow).then((value) => value.data.workflow); }
export function approveContentWorkflow(signalId: string, workflowId: string, variationId: string, draftHash: string) { return request(`/signals/${signalId}/workflows/${workflowId}/approve`, { method: "POST", body: JSON.stringify({ variationId, draftHash }), timeoutMs: 160_000 }, workflow).then((value) => value.data.workflow); }
export function reviewContentWorkflowVariation(signalId: string, workflowId: string, variationId: string) {
  return request(`/signals/${signalId}/workflows/${workflowId}/reviews`, {
    method: "POST",
    body: JSON.stringify({ requestId: `workflow-${workflowId}-review-${variationId}`, variationId }),
    timeoutMs: 160_000,
  }, workflow).then((value) => value.data.workflow);
}
