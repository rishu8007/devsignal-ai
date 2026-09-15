"use client";

import { request } from "@/lib/api/api-client";
import type { PublicSignal } from "@/lib/api/signal-client";

export type GenerationAngle = "technical_depth" | "learning_story" | "professional_impact";
export type DraftStatus = "draft" | "approved";

export interface PublicSourceCitation {
  sourceId: string;
  title: string;
  contentVersion: number;
  chunkId: string;
  startOffset: number;
  endOffset: number;
}

export interface PublicDraft {
  id: string;
  angle: GenerationAngle;
  content: string;
  status: DraftStatus;
  scheduledFor: string | null;
  sourceCitations: PublicSourceCitation[];
}

export interface PublicGeneration {
  id: string;
  signalId: string;
  model: string;
  usedKnowledge: boolean;
  variations: PublicDraft[];
  createdAt: string;
  updatedAt: string;
}

interface GenerationEnvelope {
  success: true;
  data: { generation: PublicGeneration };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGenerationAngle(value: unknown): value is GenerationAngle {
  return (
    value === "technical_depth" ||
    value === "learning_story" ||
    value === "professional_impact"
  );
}

function isSourceCitation(value: unknown): value is PublicSourceCitation {
  if (!isRecord(value)) return false;
  const { contentVersion, startOffset, endOffset } = value;
  return (
    typeof value.sourceId === "string" &&
    typeof value.title === "string" &&
    typeof contentVersion === "number" &&
    Number.isInteger(contentVersion) &&
    contentVersion > 0 &&
    typeof value.chunkId === "string" &&
    typeof startOffset === "number" &&
    Number.isInteger(startOffset) &&
    startOffset >= 0 &&
    typeof endOffset === "number" &&
    Number.isInteger(endOffset) &&
    endOffset > startOffset
  );
}

function isGeneration(value: unknown): value is PublicGeneration {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.signalId !== "string") {
    return false;
  }
  if (typeof value.model !== "string" || value.model.trim() === "" || !Array.isArray(value.variations)) {
    return false;
  }
  const angles = new Set<GenerationAngle>();
  return (
    (value.usedKnowledge === undefined || typeof value.usedKnowledge === "boolean") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    value.variations.length === 3 &&
    value.variations.every((variation) => {
      if (!isRecord(variation)) return false;
      return (
        typeof variation.id === "string" &&
        isGenerationAngle(variation.angle) &&
        typeof variation.content === "string" &&
        variation.content.trim().length >= 100 &&
        variation.content.trim().length <= 3000 &&
        (variation.status === "draft" || variation.status === "approved") &&
        (variation.scheduledFor === undefined ||
          variation.scheduledFor === null ||
          typeof variation.scheduledFor === "string") &&
        (variation.sourceCitations === undefined ||
          (Array.isArray(variation.sourceCitations) &&
            variation.sourceCitations.every(isSourceCitation))) &&
        !angles.has(variation.angle) &&
        angles.add(variation.angle)
      );
    }) &&
    angles.size === 3
  );
}

function normalizeGeneration(value: PublicGeneration): PublicGeneration {
  return {
    ...value,
    usedKnowledge: value.usedKnowledge ?? false,
    variations: value.variations.map((variation) => ({
      ...variation,
      scheduledFor: variation.scheduledFor ?? null,
      sourceCitations: variation.sourceCitations?.map((citation) => ({
        sourceId: citation.sourceId,
        title: citation.title,
        contentVersion: citation.contentVersion,
        chunkId: citation.chunkId,
        startOffset: citation.startOffset,
        endOffset: citation.endOffset,
      })) ?? [],
    })),
  };
}

function isGenerationResponse(value: unknown): value is GenerationEnvelope {
  return (
    isRecord(value) &&
    value.success === true &&
    isRecord(value.data) &&
    isGeneration(value.data.generation)
  );
}

export function getGeneration(
  signalId: string,
  signal?: AbortSignal,
): Promise<PublicGeneration> {
  return request(
    `/signals/${encodeURIComponent(signalId)}/generations`,
    { method: "GET", signal, timeoutMs: 160_000 },
    isGenerationResponse,
  ).then((response) => normalizeGeneration(response.data.generation));
}

export function createGeneration(
  signalId: string,
  useKnowledge = false,
): Promise<PublicGeneration> {
  return request(
    `/signals/${encodeURIComponent(signalId)}/generations`,
    { method: "POST", body: JSON.stringify({ useKnowledge }), timeoutMs: 160_000 },
    isGenerationResponse,
  ).then((response) => normalizeGeneration(response.data.generation));
}

export function editGeneration(
  signalId: string,
  variationId: string,
  content: string,
): Promise<PublicGeneration> {
  return request(
    `/signals/${encodeURIComponent(signalId)}/generations/${encodeURIComponent(variationId)}`,
    { method: "PATCH", body: JSON.stringify({ content }), timeoutMs: 160_000 },
    isGenerationResponse,
  ).then((response) => normalizeGeneration(response.data.generation));
}

export function approveGeneration(
  signalId: string,
  variationId: string,
): Promise<PublicGeneration> {
  return request(
    `/signals/${encodeURIComponent(signalId)}/generations/${encodeURIComponent(variationId)}/approve`,
    { method: "POST", body: "{}", timeoutMs: 160_000 },
    isGenerationResponse,
  ).then((response) => normalizeGeneration(response.data.generation));
}

export function scheduleGeneration(
  signalId: string,
  variationId: string,
  scheduledFor: string,
): Promise<PublicGeneration> {
  return request(
    `/signals/${encodeURIComponent(signalId)}/generations/${encodeURIComponent(variationId)}/schedule`,
    { method: "PUT", body: JSON.stringify({ scheduledFor }), timeoutMs: 160_000 },
    isGenerationResponse,
  ).then((response) => normalizeGeneration(response.data.generation));
}

export function removeGenerationSchedule(
  signalId: string,
  variationId: string,
): Promise<PublicGeneration> {
  return request(
    `/signals/${encodeURIComponent(signalId)}/generations/${encodeURIComponent(variationId)}/schedule`,
    { method: "DELETE", timeoutMs: 160_000 },
    isGenerationResponse,
  ).then((response) => normalizeGeneration(response.data.generation));
}

export type GenerationSignal = Pick<PublicSignal, "id" | "topic">;
