"use client";

import { ApiClientError, request } from "@/lib/api/api-client";

export type KnowledgeSourceProcessingStatus = "pending" | "indexing" | "indexed" | "failed";
export const KNOWLEDGE_SEARCH_QUERY_MAX_CODE_POINTS = 1000;

export interface PublicKnowledgeSource {
  id: string;
  title: string;
  content: string;
  contentVersion: number;
  processingStatus: KnowledgeSourceProcessingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSourceListResponse {
  sources: PublicKnowledgeSource[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface KnowledgeSearchCandidate {
  sourceId: string;
  title: string;
  contentVersion: number;
  chunkId: string;
  chunkIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  score: number;
}

export interface KnowledgeSearchResponse {
  candidates: KnowledgeSearchCandidate[];
}

interface KnowledgeSourceEnvelope {
  success: true;
  data: { source: PublicKnowledgeSource };
}

interface KnowledgeSourceListEnvelope {
  success: true;
  data: KnowledgeSourceListResponse;
}

interface KnowledgeSourceDeleteEnvelope {
  success: true;
  data: { message: "Knowledge source deleted" };
}

export interface UpdateKnowledgeSourceInput {
  title: string;
  content: string;
  expectedContentVersion: number;
}

interface KnowledgeSearchEnvelope {
  success: true;
  data: KnowledgeSearchResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProcessingStatus(value: unknown): value is KnowledgeSourceProcessingStatus {
  return value === "pending" || value === "indexing" || value === "indexed" || value === "failed";
}

function isPublicKnowledgeSource(value: unknown): value is PublicKnowledgeSource {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.content === "string" &&
    typeof value.contentVersion === "number" &&
    Number.isInteger(value.contentVersion) &&
    value.contentVersion >= 1 &&
    isProcessingStatus(value.processingStatus) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isKnowledgeSourceResponse(value: unknown): value is KnowledgeSourceEnvelope {
  return (
    isRecord(value) &&
    value.success === true &&
    isRecord(value.data) &&
    isPublicKnowledgeSource(value.data.source)
  );
}

function isKnowledgeSourceListResponse(value: unknown): value is KnowledgeSourceListEnvelope {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return false;
  const pagination = value.data.pagination;
  return (
    Array.isArray(value.data.sources) &&
    value.data.sources.every(isPublicKnowledgeSource) &&
    isRecord(pagination) &&
    typeof pagination.page === "number" &&
    Number.isInteger(pagination.page) &&
    typeof pagination.limit === "number" &&
    Number.isInteger(pagination.limit) &&
    typeof pagination.total === "number" &&
    Number.isInteger(pagination.total) &&
    typeof pagination.totalPages === "number" &&
    Number.isInteger(pagination.totalPages)
  );
}

function isKnowledgeSourceDeleteResponse(
  value: unknown,
): value is KnowledgeSourceDeleteEnvelope {
  return (
    isRecord(value) &&
    value.success === true &&
    isRecord(value.data) &&
    value.data.message === "Knowledge source deleted"
  );
}

export function updateKnowledgeSource(
  sourceId: string,
  payload: UpdateKnowledgeSourceInput,
  signal?: AbortSignal,
): Promise<PublicKnowledgeSource> {
  return request(
    `/sources/${encodeURIComponent(sourceId)}`,
    { method: "PATCH", body: JSON.stringify(payload), signal },
    isKnowledgeSourceResponse,
  ).then((response) => response.data.source);
}

function isKnowledgeSearchCandidate(value: unknown): value is KnowledgeSearchCandidate {
  return (
    isRecord(value) &&
    typeof value.sourceId === "string" &&
    typeof value.title === "string" &&
    typeof value.contentVersion === "number" &&
    Number.isInteger(value.contentVersion) &&
    value.contentVersion >= 1 &&
    typeof value.chunkId === "string" &&
    typeof value.chunkIndex === "number" &&
    Number.isInteger(value.chunkIndex) &&
    value.chunkIndex >= 0 &&
    typeof value.text === "string" &&
    typeof value.startOffset === "number" &&
    Number.isInteger(value.startOffset) &&
    value.startOffset >= 0 &&
    typeof value.endOffset === "number" &&
    Number.isInteger(value.endOffset) &&
    value.endOffset >= value.startOffset &&
    typeof value.score === "number" &&
    Number.isFinite(value.score)
  );
}

function isKnowledgeSearchResponse(value: unknown): value is KnowledgeSearchEnvelope {
  return (
    isRecord(value) &&
    value.success === true &&
    isRecord(value.data) &&
    Array.isArray(value.data.candidates) &&
    value.data.candidates.every(isKnowledgeSearchCandidate)
  );
}

export function createKnowledgeSource(payload: {
  title: string;
  content: string;
}): Promise<PublicKnowledgeSource> {
  return request(
    "/sources",
    { method: "POST", body: JSON.stringify(payload) },
    isKnowledgeSourceResponse,
  ).then((response) => response.data.source);
}

export function listKnowledgeSources({
  page,
  limit,
  processingStatus,
  signal,
}: {
  page: number;
  limit: number;
  processingStatus?: KnowledgeSourceProcessingStatus;
  signal?: AbortSignal;
}): Promise<KnowledgeSourceListResponse> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (processingStatus) query.set("processingStatus", processingStatus);

  return request(
    `/sources?${query.toString()}`,
    { method: "GET", signal },
    isKnowledgeSourceListResponse,
  ).then((response) => response.data);
}

export function getKnowledgeSource(
  sourceId: string,
  signal?: AbortSignal,
): Promise<PublicKnowledgeSource> {
  return request(
    `/sources/${encodeURIComponent(sourceId)}`,
    { method: "GET", signal },
    isKnowledgeSourceResponse,
  ).then((response) => response.data.source);
}

export function searchKnowledgeSources(
  query: string,
  signal?: AbortSignal,
): Promise<KnowledgeSearchResponse> {
  const normalizedQuery = query.trim();
  const queryLength = Array.from(normalizedQuery).length;
  if (queryLength === 0 || queryLength > KNOWLEDGE_SEARCH_QUERY_MAX_CODE_POINTS) {
    throw new ApiClientError(
      "Search queries must contain 1–1000 Unicode characters.",
      422,
      "VALIDATION_ERROR",
    );
  }
  return request(
    "/sources/search",
    {
      method: "POST",
      body: JSON.stringify({ query: normalizedQuery, limit: 5 }),
      signal,
    },
    isKnowledgeSearchResponse,
  ).then((response) => response.data);
}

export function deleteKnowledgeSource(sourceId: string): Promise<void> {
  return request(
    `/sources/${encodeURIComponent(sourceId)}`,
    { method: "DELETE" },
    isKnowledgeSourceDeleteResponse,
  ).then(() => undefined);
}

export function indexKnowledgeSource(
  sourceId: string,
  timeoutMs?: number,
): Promise<PublicKnowledgeSource> {
  return request(
    `/sources/${encodeURIComponent(sourceId)}/index`,
    { method: "POST", body: JSON.stringify({}), timeoutMs },
    isKnowledgeSourceResponse,
  ).then((response) => response.data.source);
}
