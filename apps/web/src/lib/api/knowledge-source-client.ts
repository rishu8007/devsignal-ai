"use client";

import { request } from "@/lib/api/api-client";

export type KnowledgeSourceProcessingStatus = "pending" | "indexing" | "indexed" | "failed";

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
  signal,
}: {
  page: number;
  limit: number;
  signal?: AbortSignal;
}): Promise<KnowledgeSourceListResponse> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

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

export function deleteKnowledgeSource(sourceId: string): Promise<void> {
  return request(
    `/sources/${encodeURIComponent(sourceId)}`,
    { method: "DELETE" },
    isKnowledgeSourceDeleteResponse,
  ).then(() => undefined);
}
