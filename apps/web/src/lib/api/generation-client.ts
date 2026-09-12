"use client";

import { request } from "@/lib/api/api-client";
import type { PublicSignal } from "@/lib/api/signal-client";

export type GenerationAngle = "technical_depth" | "learning_story" | "professional_impact";
export type DraftStatus = "draft" | "approved";

export interface PublicDraft {
  id: string;
  angle: GenerationAngle;
  content: string;
  status: DraftStatus;
}

export interface PublicGeneration {
  id: string;
  signalId: string;
  model: string;
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

function isGeneration(value: unknown): value is PublicGeneration {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.signalId !== "string") {
    return false;
  }
  if (typeof value.model !== "string" || value.model.trim() === "" || !Array.isArray(value.variations)) {
    return false;
  }
  const angles = new Set<GenerationAngle>();
  return (
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
        !angles.has(variation.angle) &&
        angles.add(variation.angle)
      );
    }) &&
    angles.size === 3
  );
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
  ).then((response) => response.data.generation);
}

export function createGeneration(signalId: string): Promise<PublicGeneration> {
  return request(
    `/signals/${encodeURIComponent(signalId)}/generations`,
    { method: "POST", body: "{}", timeoutMs: 160_000 },
    isGenerationResponse,
  ).then((response) => response.data.generation);
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
  ).then((response) => response.data.generation);
}

export function approveGeneration(
  signalId: string,
  variationId: string,
): Promise<PublicGeneration> {
  return request(
    `/signals/${encodeURIComponent(signalId)}/generations/${encodeURIComponent(variationId)}/approve`,
    { method: "POST", body: "{}", timeoutMs: 160_000 },
    isGenerationResponse,
  ).then((response) => response.data.generation);
}

export type GenerationSignal = Pick<PublicSignal, "id" | "topic">;
