"use client";

import { request } from "@/lib/api/api-client";
import {
  CONTENT_TYPES,
  PRIMARY_AUDIENCES,
  type ContentType,
  type PrimaryAudience,
} from "@/lib/validation/signal-form";

export interface PublicSignal {
  id: string;
  topic: string;
  notes: string;
  primaryAudience: PrimaryAudience;
  contentType: ContentType;
  createdAt: string;
  updatedAt: string;
}

export type SignalPayload = Omit<PublicSignal, "id" | "createdAt" | "updatedAt">;

export interface SignalListResponse {
  signals: PublicSignal[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface SignalResponseEnvelope {
  success: true;
  data: { signal: PublicSignal };
}

interface SignalListEnvelope {
  success: true;
  data: SignalListResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPrimaryAudience(value: unknown): value is PrimaryAudience {
  return typeof value === "string" && PRIMARY_AUDIENCES.some((option) => option === value);
}

function isContentType(value: unknown): value is ContentType {
  return typeof value === "string" && CONTENT_TYPES.some((option) => option === value);
}

function isPublicSignal(value: unknown): value is PublicSignal {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.topic === "string" &&
    typeof value.notes === "string" &&
    isPrimaryAudience(value.primaryAudience) &&
    isContentType(value.contentType) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isSignalResponse(value: unknown): value is SignalResponseEnvelope {
  return (
    isRecord(value) &&
    value.success === true &&
    isRecord(value.data) &&
    isPublicSignal(value.data.signal)
  );
}

function isSignalListResponse(value: unknown): value is SignalListEnvelope {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return false;
  const pagination = value.data.pagination;
  return (
    Array.isArray(value.data.signals) &&
    value.data.signals.every(isPublicSignal) &&
    isRecord(pagination) &&
    typeof pagination.page === "number" &&
    typeof pagination.limit === "number" &&
    typeof pagination.total === "number" &&
    typeof pagination.totalPages === "number"
  );
}

export async function createSignal(payload: SignalPayload): Promise<PublicSignal> {
  const response = await request(
    "/signals",
    { method: "POST", body: JSON.stringify(payload) },
    isSignalResponse,
  );
  return response.data.signal;
}

export async function listSignals({
  page,
  limit,
  signal,
}: {
  page: number;
  limit: number;
  signal?: AbortSignal;
}): Promise<SignalListResponse> {
  const response = await request(
    `/signals?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`,
    { method: "GET", signal },
    isSignalListResponse,
  );
  return response.data;
}
