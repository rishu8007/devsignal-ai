import { createHash, randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import type { LinkedInPublishingClient } from "../clients/linkedin-publishing.client.js";
import { linkedinPublishingClient } from "../clients/linkedin-publishing.client.js";
import {
  claimLinkedInPublication,
  createLinkedInPublication,
  findLinkedInConnection,
  findLinkedInPublication,
  findLinkedInPublicationByOperationKey,
  listLinkedInPublications,
  updateLinkedInPublication,
} from "../repositories/linkedin.repository.js";
import { findGenerationByOwnerAndSignal } from "../repositories/generation.repository.js";
import { listContentWorkflows } from "../repositories/content-workflow.repository.js";
import { decryptLinkedInSecret } from "./linkedin-crypto.js";

const previewLifetimeMs = 10 * 60 * 1000;
const publicationVisibility = "PUBLIC" as const;

type PublicationRecord = Awaited<ReturnType<typeof findLinkedInPublication>>;

export interface LinkedInPublicationRepository {
  findConnection: typeof findLinkedInConnection;
  findPublication: typeof findLinkedInPublication;
  findByOperationKey: typeof findLinkedInPublicationByOperationKey;
  createPublication: typeof createLinkedInPublication;
  claimPublication: typeof claimLinkedInPublication;
  updatePublication: typeof updateLinkedInPublication;
  listPublications: typeof listLinkedInPublications;
  findGeneration: typeof findGenerationByOwnerAndSignal;
  listWorkflows: typeof listContentWorkflows;
}

const defaultRepository: LinkedInPublicationRepository = {
  findConnection: findLinkedInConnection,
  findPublication: findLinkedInPublication,
  findByOperationKey: findLinkedInPublicationByOperationKey,
  createPublication: createLinkedInPublication,
  claimPublication: claimLinkedInPublication,
  updatePublication: updateLinkedInPublication,
  listPublications: listLinkedInPublications,
  findGeneration: findGenerationByOwnerAndSignal,
  listWorkflows: listContentWorkflows,
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codePoints(value: string): number {
  return Array.from(value).length;
}

function requirePublishingEnabled(): void {
  if (!env.LINKEDIN_PUBLISHING_ENABLED || !env.LINKEDIN_ENABLED || !env.LINKEDIN_TOKEN_ENCRYPTION_KEY) {
    throw new AppError(503, "LINKEDIN_PUBLISHING_NOT_CONFIGURED", "LinkedIn publishing is not enabled.");
  }
}

function publicPublication(publication: NonNullable<PublicationRecord>) {
  return {
    id: publication.previewId,
    signalId: publication.signalId.toString(),
    generationId: publication.generationId.toString(),
    variationId: publication.variationId.toString(),
    text: publication.textSnapshot,
    draftContentHash: publication.draftContentHash,
    account: { memberId: publication.providerMemberId, displayName: publication.providerDisplayName },
    visibility: publication.visibility,
    status: publication.status === "dispatching" ? "uncertain" : publication.status,
    providerPostId: publication.providerPostId,
    postUrl: publication.providerPostId
      ? `https://www.linkedin.com/feed/update/${encodeURIComponent(publication.providerPostId)}`
      : null,
    errorCode: publication.errorCode,
    errorMessage: publication.errorMessage,
    previewExpiresAt: publication.previewExpiresAt,
    createdAt: publication.createdAt,
    dispatchedAt: publication.dispatchedAt,
    publishedAt: publication.publishedAt,
  };
}

async function resolveApprovedDraft(ownerId: string, signalId: string, variationId: string, repository: LinkedInPublicationRepository) {
  if (!Types.ObjectId.isValid(signalId) || !Types.ObjectId.isValid(variationId)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid request data.");
  }
  const generation = await repository.findGeneration(ownerId, signalId);
  const variation = generation?.variations.find((item) => item._id.toString() === variationId);
  if (!generation || !variation) throw new AppError(404, "DRAFT_NOT_FOUND", "Draft not found.");
  const draftHash = hash(variation.content);
  let approved = variation.status === "approved";
  if (!approved) {
    const workflows = await repository.listWorkflows(ownerId, signalId);
    approved = workflows.some(
      (workflow) =>
        workflow.status === "completed" &&
        workflow.generationId?.toString() === generation._id.toString() &&
        workflow.approvedVariationId?.toString() === variation._id.toString() &&
        workflow.approvedDraftHash === draftHash,
    );
  }
  if (!approved) throw new AppError(409, "DRAFT_NOT_APPROVED", "Only an approved draft can be published.");
  if (codePoints(variation.content) > 3000) {
    throw new AppError(409, "DRAFT_TOO_LONG", "This draft exceeds LinkedIn's text limit.");
  }
  return { generation, variation, draftHash };
}

async function requirePublishableConnection(ownerId: string, repository: LinkedInPublicationRepository) {
  const connection = await repository.findConnection(ownerId);
  if (
    !connection ||
    connection.status !== "connected" ||
    !connection.accessTokenEncrypted ||
    connection.expiresAt <= new Date() ||
    !connection.capabilities?.posting ||
    !connection.grantedScopes.includes("w_member_social")
  ) {
    throw new AppError(409, "LINKEDIN_POSTING_NOT_AVAILABLE", "Reconnect LinkedIn with member posting permission before publishing.");
  }
  return connection;
}

function operationKey(ownerId: string, generationId: string, variationId: string, draftHash: string, memberId: string, generation: number): string {
  return hash(JSON.stringify({ ownerId, generationId, variationId, draftHash, memberId, generation, visibility: publicationVisibility }));
}

export async function createLinkedInPublicationPreview(
  ownerId: string,
  signalId: string,
  variationId: string,
  now = new Date(),
  repository: LinkedInPublicationRepository = defaultRepository,
) {
  requirePublishingEnabled();
  const { generation, variation, draftHash } = await resolveApprovedDraft(ownerId, signalId, variationId, repository);
  const connection = await requirePublishableConnection(ownerId, repository);
  const key = operationKey(ownerId, generation._id.toString(), variation._id.toString(), draftHash, connection.providerMemberId, connection.connectionGeneration);
  const existing = await repository.findByOperationKey(ownerId, key);
  if (existing) return publicPublication(existing);
  const input = {
    ownerId,
    signalId,
    generationId: generation._id,
    variationId: variation._id,
    draftContentHash: draftHash,
    textSnapshot: variation.content,
    providerMemberId: connection.providerMemberId,
    providerDisplayName: connection.displayName,
    connectionGeneration: connection.connectionGeneration,
    visibility: publicationVisibility,
    operationKey: key,
    previewId: randomUUID(),
    previewExpiresAt: new Date(now.getTime() + previewLifetimeMs),
    status: "pending",
  };
  try {
    const created = await repository.createPublication(input);
    return publicPublication(created.toObject ? created.toObject() as NonNullable<PublicationRecord> : created as NonNullable<PublicationRecord>);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === 11000) {
      const duplicate = await repository.findByOperationKey(ownerId, key);
      if (duplicate) return publicPublication(duplicate);
    }
    throw error;
  }
}

export async function confirmLinkedInPublication(
  ownerId: string,
  previewId: string,
  publishingClient: LinkedInPublishingClient = linkedinPublishingClient,
  now = new Date(),
  repository: LinkedInPublicationRepository = defaultRepository,
) {
  requirePublishingEnabled();
  const existing = await repository.findPublication(ownerId, previewId);
  if (!existing) throw new AppError(404, "PUBLICATION_NOT_FOUND", "Publication preview not found.");
  if (existing.status !== "pending") return publicPublication(existing);
  if (existing.previewExpiresAt <= now) {
    const expired = await repository.updatePublication(existing._id.toString(), {
      status: "rejected",
      errorCode: "PREVIEW_EXPIRED",
      errorMessage: "This preview expired. Create a new preview before publishing.",
    });
    if (expired) return publicPublication(expired);
    throw new AppError(409, "PREVIEW_EXPIRED", "This preview expired. Create a new preview before publishing.");
  }

  const { generation, variation, draftHash } = await resolveApprovedDraft(ownerId, existing.signalId.toString(), existing.variationId.toString(), repository);
  const connection = await requirePublishableConnection(ownerId, repository);
  if (
    generation._id.toString() !== existing.generationId.toString() ||
    hash(variation.content) !== existing.draftContentHash ||
    draftHash !== existing.draftContentHash ||
    connection.providerMemberId !== existing.providerMemberId ||
    connection.connectionGeneration !== existing.connectionGeneration
  ) {
    await repository.updatePublication(existing._id.toString(), {
      status: "rejected",
      errorCode: "PUBLICATION_INPUT_CHANGED",
      errorMessage: "The draft or LinkedIn connection changed. Create a new preview.",
    });
    throw new AppError(409, "PUBLICATION_INPUT_CHANGED", "The draft or LinkedIn connection changed. Create a new preview.");
  }

  const claimed = await repository.claimPublication(existing._id.toString(), now);
  if (!claimed) {
    const current = await repository.findPublication(ownerId, previewId);
    if (current) return publicPublication(current);
    throw new AppError(409, "PUBLICATION_CONFLICT", "This publication is already being processed.");
  }

  const encryptedAccessToken = connection.accessTokenEncrypted;
  if (!encryptedAccessToken || !env.LINKEDIN_TOKEN_ENCRYPTION_KEY) {
    throw new AppError(409, "LINKEDIN_POSTING_NOT_AVAILABLE", "Reconnect LinkedIn with member posting permission before publishing.");
  }
  const accessToken = decryptLinkedInSecret(encryptedAccessToken, env.LINKEDIN_TOKEN_ENCRYPTION_KEY);
  const result = await publishingClient.publishTextPost(accessToken, connection.providerMemberId, existing.textSnapshot);
  const update = result.kind === "published"
    ? { status: "published", providerPostId: result.providerPostId, publishedAt: new Date(), errorCode: null, errorMessage: null }
    : { status: result.kind, errorCode: result.errorCode, errorMessage: result.errorMessage };
  const completed = await repository.updatePublication(existing._id.toString(), update);
  if (!completed) throw new AppError(503, "PUBLICATION_PERSISTENCE_UNCERTAIN", "The publication result could not be saved. Check LinkedIn before taking further action.");
  return publicPublication(completed);
}

export async function listLinkedInPublicationHistory(ownerId: string, repository: LinkedInPublicationRepository = defaultRepository) {
  requirePublishingEnabled();
  const records = await repository.listPublications(ownerId);
  return records.map(publicPublication);
}
