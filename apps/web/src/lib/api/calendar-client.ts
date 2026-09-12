import { request } from "@/lib/api/api-client";
import type { GenerationAngle, DraftStatus } from "@/lib/api/generation-client";

export interface PublicCalendarItem {
  id: string;
  generationId: string;
  signalId: string;
  topic: string;
  angle: GenerationAngle;
  content: string;
  status: DraftStatus;
  scheduledFor: string;
}

export interface CalendarResponse {
  items: PublicCalendarItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface CalendarEnvelope {
  success: true;
  data: CalendarResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAngle(value: unknown): value is GenerationAngle {
  return value === "technical_depth" || value === "learning_story" || value === "professional_impact";
}

function isCalendarResponse(value: unknown): value is CalendarEnvelope {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return false;
  const { items, pagination } = value.data;
  return (
    Array.isArray(items) &&
    items.every((item) => {
      if (!isRecord(item)) return false;
      return (
        typeof item.id === "string" &&
        typeof item.generationId === "string" &&
        typeof item.signalId === "string" &&
        typeof item.topic === "string" &&
        isAngle(item.angle) &&
        typeof item.content === "string" &&
        item.status === "approved" &&
        typeof item.scheduledFor === "string"
      );
    }) &&
    isRecord(pagination) &&
    typeof pagination.page === "number" &&
    typeof pagination.limit === "number" &&
    typeof pagination.total === "number" &&
    typeof pagination.totalPages === "number"
  );
}

export function listCalendar({
  from,
  to,
  page,
  limit,
  signal,
}: {
  from: string;
  to: string;
  page: number;
  limit: number;
  signal?: AbortSignal;
}): Promise<CalendarResponse> {
  const query = new URLSearchParams({
    from,
    to,
    page: String(page),
    limit: String(limit),
  });
  return request(
    `/calendar?${query.toString()}`,
    { method: "GET", signal },
    isCalendarResponse,
  ).then((response) => response.data);
}
