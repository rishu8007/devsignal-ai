import { request } from "@/lib/api/api-client";
import type { GenerationAngle, DraftStatus } from "@/lib/api/generation-client";

export interface PublicDraftLibraryItem {
  id: string;
  generationId: string;
  signalId: string;
  topic: string;
  angle: GenerationAngle;
  content: string;
  status: DraftStatus;
  generationUpdatedAt: string;
}

export interface DraftLibraryResponse {
  drafts: PublicDraftLibraryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: {
    draft: number;
    approved: number;
    total: number;
  };
}

interface DraftLibraryEnvelope {
  success: true;
  data: DraftLibraryResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAngle(value: unknown): value is GenerationAngle {
  return (
    value === "technical_depth" ||
    value === "learning_story" ||
    value === "professional_impact"
  );
}

function isStatus(value: unknown): value is DraftStatus {
  return value === "draft" || value === "approved";
}

function isDraft(value: unknown): value is PublicDraftLibraryItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.generationId === "string" &&
    typeof value.signalId === "string" &&
    typeof value.topic === "string" &&
    isAngle(value.angle) &&
    typeof value.content === "string" &&
    value.content.trim().length >= 100 &&
    value.content.trim().length <= 3000 &&
    isStatus(value.status) &&
    typeof value.generationUpdatedAt === "string"
  );
}

function isDraftLibraryResponse(value: unknown): value is DraftLibraryEnvelope {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return false;
  const { drafts, pagination, summary } = value.data;
  return (
    Array.isArray(drafts) &&
    drafts.every(isDraft) &&
    isRecord(pagination) &&
    typeof pagination.page === "number" &&
    typeof pagination.limit === "number" &&
    typeof pagination.total === "number" &&
    typeof pagination.totalPages === "number" &&
    isRecord(summary) &&
    typeof summary.draft === "number" &&
    typeof summary.approved === "number" &&
    typeof summary.total === "number"
  );
}

export function listDrafts({
  page,
  limit,
  status,
  signal,
}: {
  page: number;
  limit: number;
  status?: DraftStatus;
  signal?: AbortSignal;
}): Promise<DraftLibraryResponse> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (status) query.set("status", status);

  return request(
    `/drafts?${query.toString()}`,
    { method: "GET", signal },
    isDraftLibraryResponse,
  ).then((response) => response.data);
}
