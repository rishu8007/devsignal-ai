import { Types } from "mongoose";
import { aiRetrievalClient, type AiRetrievalClient } from "../clients/retrieval.client.js";
import type { AiRetrievalCandidate, AiRetrievalCandidates } from "../clients/retrieval.types.js";
import { AppError } from "../errors/app-error.js";
import type { KnowledgeSourceDocument } from "../models/knowledge-source.model.js";
import { findKnowledgeSourcesByIdsAndOwner } from "../repositories/knowledge-source.repository.js";
import { admitAiOperation, completeAiOperation, markAiDispatched, markAiUncertain, releaseAiOperation } from "./usage.service.js";

export interface PublicRetrievalCandidate {
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

export interface RetrievalRepositoryBoundary {
  findKnowledgeSourcesByIdsAndOwner: typeof findKnowledgeSourcesByIdsAndOwner;
}

const defaultRepository: RetrievalRepositoryBoundary = { findKnowledgeSourcesByIdsAndOwner };

export async function searchKnowledgeSourcesForUser(
  ownerId: string,
  query: string,
  limit: number,
  client: AiRetrievalClient = aiRetrievalClient,
  repository: RetrievalRepositoryBoundary = defaultRepository,
): Promise<PublicRetrievalCandidate[]> {
  if (!Types.ObjectId.isValid(ownerId)) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }
  const trackUsage = client === aiRetrievalClient && repository === defaultRepository;
  const admission = trackUsage ? await admitAiOperation(ownerId, `retrieval:${Buffer.from(query).toString("base64url")}:${limit}`, "retrieval") : null;
  if (admission?.duplicate) {
    throw new AppError(409, "AI_OPERATION_IN_PROGRESS", "This AI operation is already in progress");
  }
  if (admission) await markAiDispatched(admission.id);
  let candidates: AiRetrievalCandidate[];
  try {
    candidates = await client.retrieve({ ownerId, query, limit });
    if (admission) await completeAiOperation(admission.id, (candidates as AiRetrievalCandidates).usage);
  } catch (error) {
    if (admission && error instanceof AppError && [502, 504].includes(error.statusCode)) await markAiUncertain(admission.id);
    else if (admission) await releaseAiOperation(admission.id);
    throw error;
  }
  const sourceIds = [...new Set(candidates.map((candidate) => candidate.sourceId.toLowerCase()))];
  const sources = await repository.findKnowledgeSourcesByIdsAndOwner(ownerId, sourceIds);
  const byId = new Map(sources.map((source) => [source._id.toString().toLowerCase(), source]));
  const identities = new Set<string>();
  const valid: PublicRetrievalCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.ownerId.toLowerCase() !== ownerId.toLowerCase()) {
      continue;
    }
    const source = byId.get(candidate.sourceId.toLowerCase());
    if (!source || !isCompatibleIndexedSource(source, candidate)) {
      continue;
    }
    const normalizedContent = normalizeLineEndings(source.content);
    const codePoints = Array.from(normalizedContent);
    const text = codePoints.slice(candidate.startOffset, candidate.endOffset).join("");
    if (
      candidate.endOffset <= candidate.startOffset ||
      candidate.endOffset > codePoints.length ||
      text !== candidate.text
    ) {
      continue;
    }
    const identity = `${candidate.sourceId.toLowerCase()}:${candidate.chunkId}`;
    if (identities.has(identity)) {
      continue;
    }
    identities.add(identity);
    valid.push({
      sourceId: source._id.toString(),
      title: source.title,
      contentVersion: source.contentVersion,
      chunkId: candidate.chunkId,
      chunkIndex: candidate.chunkIndex,
      text: candidate.text,
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
      score: candidate.score,
    });
    if (valid.length === limit) {
      break;
    }
  }
  return valid;
}

function isCompatibleIndexedSource(
  source: KnowledgeSourceDocument,
  candidate: AiRetrievalCandidate,
): boolean {
  return (
    source.processingStatus === "indexed" &&
    source.contentVersion === candidate.contentVersion &&
    source.indexedContentVersion === candidate.contentVersion &&
    source.indexedChunkerVersion === candidate.chunkerVersion &&
    source.indexedEmbeddingModel === candidate.embeddingModel &&
    (source.indexedDimensions ?? 0) > 0 &&
    candidate.chunkId ===
      `${candidate.sourceId.toLowerCase()}_v${candidate.contentVersion}_c${candidate.chunkIndex}`
  );
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
