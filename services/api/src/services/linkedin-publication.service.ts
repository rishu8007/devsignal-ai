import { createHash, randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import type { LinkedInPublishingClient } from "../clients/linkedin-publishing.client.js";
import { linkedinPublishingClient } from "../clients/linkedin-publishing.client.js";
import {
  claimLinkedInPublication,
  authorizeLinkedInPublicationDispatch,
  createLinkedInPublication,
  findLinkedInConnection,
  findLinkedInPublication,
  findLinkedInPublicationByOperationKey,
  listLinkedInPublications,
  updateLinkedInPublication,
  scheduleLinkedInPublication as scheduleStoredPublication,
  cancelLinkedInPublication as cancelStoredPublication,
  rescheduleLinkedInPublication as rescheduleStoredPublication,
  claimDueLinkedInPublication as claimDueStoredPublication,
  fenceLinkedInPublication as fenceStoredPublication,
  blockUnpublishedLinkedInPublication as blockUnpublishedStoredPublication,
  recoverExpiredLinkedInDispatch as recoverExpiredStoredDispatch,
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
  authorizeDispatch: typeof authorizeLinkedInPublicationDispatch;
  updatePublication: typeof updateLinkedInPublication;
  listPublications: typeof listLinkedInPublications;
  findGeneration: typeof findGenerationByOwnerAndSignal;
  listWorkflows: typeof listContentWorkflows;
  schedulePublication: typeof scheduleStoredPublication;
  cancelPublication: typeof cancelStoredPublication;
  reschedulePublication: typeof rescheduleStoredPublication;
  claimDuePublication: typeof claimDueStoredPublication;
  fencePublication: typeof fenceStoredPublication;
  blockUnpublishedPublication: typeof blockUnpublishedStoredPublication;
  recoverExpiredDispatch: typeof recoverExpiredStoredDispatch;
}

const defaultRepository: LinkedInPublicationRepository = {
  findConnection: findLinkedInConnection,
  findPublication: findLinkedInPublication,
  findByOperationKey: findLinkedInPublicationByOperationKey,
  createPublication: createLinkedInPublication,
  claimPublication: claimLinkedInPublication,
  authorizeDispatch: authorizeLinkedInPublicationDispatch,
  updatePublication: updateLinkedInPublication,
  listPublications: listLinkedInPublications,
  findGeneration: findGenerationByOwnerAndSignal,
  listWorkflows: listContentWorkflows,
  schedulePublication: scheduleStoredPublication,
  cancelPublication: cancelStoredPublication,
  reschedulePublication: rescheduleStoredPublication,
  claimDuePublication: claimDueStoredPublication,
  fencePublication: fenceStoredPublication,
  blockUnpublishedPublication: blockUnpublishedStoredPublication,
  recoverExpiredDispatch: recoverExpiredStoredDispatch,
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codePoints(value: string): number {
  return Array.from(value).length;
}

function localKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function resolveLocalDateTime(value: string, timezone: string, disambiguation: "earlier" | "later" | undefined): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new AppError(400, "INVALID_SCHEDULE_TIME", "Use a local date and time in YYYY-MM-DDTHH:mm format.");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); }
  catch { throw new AppError(400, "INVALID_TIMEZONE", "Choose a valid IANA timezone."); }
  const naive = Date.parse(`${value}:00Z`);
  const candidates: Date[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 1) {
    const candidate = new Date(naive - offset * 60_000);
    if (localKey(candidate, timezone) === value) candidates.push(candidate);
  }
  if (candidates.length === 0) throw new AppError(400, "NONEXISTENT_LOCAL_TIME", "That local time does not exist because of a daylight-saving transition.");
  if (candidates.length > 1 && !disambiguation) throw new AppError(400, "AMBIGUOUS_LOCAL_TIME", "Choose earlier or later for this repeated daylight-saving time.");
  return candidates[disambiguation === "later" ? candidates.length - 1 : 0] as Date;
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
    scheduledAt: publication.scheduledAt,
    scheduledTimezone: publication.scheduledTimezone,
    scheduleRevision: publication.scheduleRevision,
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
  let approvalFingerprint = generation.updatedAt instanceof Date ? generation.updatedAt.toISOString() : "legacy-generation";
  if (!approved) {
    const workflows = await repository.listWorkflows(ownerId, signalId);
    approved = workflows.some(
      (workflow) =>
        workflow.status === "completed" &&
        workflow.generationId?.toString() === generation._id.toString() &&
        workflow.approvedVariationId?.toString() === variation._id.toString() &&
        workflow.approvedDraftHash === draftHash,
    );
    const approvedWorkflow = workflows.find(
      (workflow) =>
        workflow.status === "completed" &&
        workflow.generationId?.toString() === generation._id.toString() &&
        workflow.approvedVariationId?.toString() === variation._id.toString() &&
        workflow.approvedDraftHash === draftHash,
    );
    if (approvedWorkflow?.updatedAt instanceof Date) approvalFingerprint = approvedWorkflow.updatedAt.toISOString();
  }
  if (!approved) throw new AppError(409, "DRAFT_NOT_APPROVED", "Only an approved draft can be published.");
  if (codePoints(variation.content) > 3000) {
    throw new AppError(409, "DRAFT_TOO_LONG", "This draft exceeds LinkedIn's text limit.");
  }
  return { generation, variation, draftHash, approvalFingerprint };
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
  const { generation, variation, draftHash, approvalFingerprint } = await resolveApprovedDraft(ownerId, signalId, variationId, repository);
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
    approvalFingerprint,
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
  await repository.recoverExpiredDispatch(now);
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

  const { generation, variation, draftHash, approvalFingerprint } = await resolveApprovedDraft(ownerId, existing.signalId.toString(), existing.variationId.toString(), repository);
  const connection = await requirePublishableConnection(ownerId, repository);
  if (
    generation._id.toString() !== existing.generationId.toString() ||
    hash(variation.content) !== existing.draftContentHash ||
    draftHash !== existing.draftContentHash ||
    approvalFingerprint !== existing.approvalFingerprint ||
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

  const leaseId = randomUUID();
  const claimed = await repository.claimPublication(existing._id.toString(), leaseId, now);
  if (!claimed) {
    const current = await repository.findPublication(ownerId, previewId);
    if (current) return publicPublication(current);
    throw new AppError(409, "PUBLICATION_CONFLICT", "This publication is already being processed.");
  }

  const authorized = await repository.authorizeDispatch(existing._id.toString(), leaseId, existing.scheduleRevision, now);
  if (!authorized) throw new AppError(409, "PUBLICATION_CONFLICT", "This publication changed before dispatch.");
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
  await repository.recoverExpiredDispatch(new Date());
  const records = await repository.listPublications(ownerId);
  return records.map(publicPublication);
}

export async function scheduleLinkedInPublication(
  ownerId: string, previewId: string, localDateTime: string, timezone: string,
  disambiguation: "earlier" | "later" | undefined, now = new Date(),
  repository: LinkedInPublicationRepository = defaultRepository,
) {
  requirePublishingEnabled();
  if (!env.LINKEDIN_SCHEDULER_ENABLED) throw new AppError(503, "LINKEDIN_SCHEDULER_NOT_CONFIGURED", "Scheduled LinkedIn publishing is not enabled.");
  const publication = await repository.findPublication(ownerId, previewId);
  if (!publication) throw new AppError(404, "PUBLICATION_NOT_FOUND", "Publication not found.");
  if (publication.status !== "pending") return publicPublication(publication);
  if (publication.previewExpiresAt <= now) throw new AppError(409, "PREVIEW_EXPIRED", "This preview expired. Create a new preview before scheduling.");
  const scheduledAt = resolveLocalDateTime(localDateTime, timezone, disambiguation);
  if (scheduledAt < new Date(now.getTime() + 5 * 60_000) || scheduledAt > new Date(now.getTime() + env.LINKEDIN_SCHEDULE_HORIZON_DAYS * 86_400_000)) {
    throw new AppError(400, "SCHEDULE_OUT_OF_RANGE", "Choose a time within the scheduling horizon.");
  }
  const current = await resolveApprovedDraft(ownerId, publication.signalId.toString(), publication.variationId.toString(), repository);
  const connection = await requirePublishableConnection(ownerId, repository);
  if (hash(current.variation.content) !== publication.draftContentHash || current.approvalFingerprint !== publication.approvalFingerprint || connection.providerMemberId !== publication.providerMemberId || connection.connectionGeneration !== publication.connectionGeneration) {
    throw new AppError(409, "PUBLICATION_INPUT_CHANGED", "The draft or LinkedIn connection changed. Create a new preview.");
  }
  const updated = await repository.schedulePublication(publication._id.toString(), publication.scheduleRevision, { scheduledAt, scheduledTimezone: timezone });
  if (!updated) throw new AppError(409, "PUBLICATION_CONFLICT", "This publication was changed by another request.");
  return publicPublication(updated);
}

export async function cancelScheduledLinkedInPublication(ownerId: string, previewId: string, expectedRevision: number, now = new Date(), repository: LinkedInPublicationRepository = defaultRepository) {
  requirePublishingEnabled();
  const publication = await repository.findPublication(ownerId, previewId);
  if (!publication) throw new AppError(404, "PUBLICATION_NOT_FOUND", "Publication not found.");
  if (publication.status === "cancelled") return publicPublication(publication);
  if (publication.status !== "scheduled") throw new AppError(409, "PUBLICATION_ALREADY_DISPATCHING", "This publication can no longer be cancelled.");
  const updated = await repository.cancelPublication(publication._id.toString(), expectedRevision, now);
  if (!updated) throw new AppError(409, "PUBLICATION_CONFLICT", "This publication was changed by another request.");
  return publicPublication(updated);
}

export async function rescheduleLinkedInPublication(ownerId: string, previewId: string, expectedRevision: number, localDateTime: string, timezone: string, disambiguation: "earlier" | "later" | undefined, now = new Date(), repository: LinkedInPublicationRepository = defaultRepository) {
  requirePublishingEnabled();
  const publication = await repository.findPublication(ownerId, previewId);
  if (!publication || publication.status !== "scheduled") throw new AppError(409, "PUBLICATION_NOT_SCHEDULED", "This publication is not scheduled.");
  const scheduledAt = resolveLocalDateTime(localDateTime, timezone, disambiguation);
  if (scheduledAt < new Date(now.getTime() + 5 * 60_000) || scheduledAt > new Date(now.getTime() + env.LINKEDIN_SCHEDULE_HORIZON_DAYS * 86_400_000)) throw new AppError(400, "SCHEDULE_OUT_OF_RANGE", "Choose a time within the scheduling horizon.");
  const updated = await repository.reschedulePublication(publication._id.toString(), expectedRevision, scheduledAt, timezone, now);
  if (!updated) throw new AppError(409, "PUBLICATION_CONFLICT", "This publication was changed by another request.");
  return publicPublication(updated);
}

export async function dispatchClaimedLinkedInPublication(publication: NonNullable<PublicationRecord>, leaseId: string, publishingClient: LinkedInPublishingClient = linkedinPublishingClient, now = new Date(), repository: LinkedInPublicationRepository = defaultRepository) {
  requirePublishingEnabled();
  if (publication.scheduledAt && now.getTime() - publication.scheduledAt.getTime() > env.LINKEDIN_SCHEDULE_LATE_WINDOW_MINUTES * 60_000) {
    const missed = await repository.blockUnpublishedPublication(publication._id.toString(), leaseId, { status: "missed", errorCode: "SCHEDULE_MISSED", errorMessage: "This job was overdue and was not published automatically." });
    return missed ? publicPublication(missed) : null;
  }
  let dispatchAuthorized = false;
  try {
    const current = await resolveApprovedDraft(publication.ownerId.toString(), publication.signalId.toString(), publication.variationId.toString(), repository);
    const connection = await requirePublishableConnection(publication.ownerId.toString(), repository);
    if (hash(current.variation.content) !== publication.draftContentHash || current.approvalFingerprint !== publication.approvalFingerprint || connection.providerMemberId !== publication.providerMemberId || connection.connectionGeneration !== publication.connectionGeneration || !publication.scheduledAt) {
      const blocked = await repository.blockUnpublishedPublication(publication._id.toString(), leaseId, { status: "blocked", errorCode: "SCHEDULE_INPUT_CHANGED", errorMessage: "The draft approval or LinkedIn connection changed. Create a fresh scheduling authorization." });
      return blocked ? publicPublication(blocked) : null;
    }
    const authorized = await repository.authorizeDispatch(publication._id.toString(), leaseId, publication.scheduleRevision, now);
    if (!authorized) return null;
    dispatchAuthorized = true;
    if (!connection.accessTokenEncrypted || !env.LINKEDIN_TOKEN_ENCRYPTION_KEY) throw new AppError(409, "LINKEDIN_POSTING_NOT_AVAILABLE", "LinkedIn posting permission is no longer available.");
    const result = await publishingClient.publishTextPost(decryptLinkedInSecret(connection.accessTokenEncrypted, env.LINKEDIN_TOKEN_ENCRYPTION_KEY), connection.providerMemberId, publication.textSnapshot);
    const update = result.kind === "published" ? { status: "published", providerPostId: result.providerPostId, publishedAt: now, errorCode: null, errorMessage: null } : { status: result.kind, errorCode: result.errorCode, errorMessage: result.errorMessage };
    const completed = await repository.fencePublication(publication._id.toString(), leaseId, update);
    return completed ? publicPublication(completed) : null;
  } catch (error) {
    const uncertain = dispatchAuthorized
      ? await repository.fencePublication(publication._id.toString(), leaseId, { status: error instanceof AppError ? "blocked" : "uncertain", errorCode: error instanceof AppError ? error.code : "SCHEDULE_EXECUTION_UNCERTAIN", errorMessage: error instanceof AppError ? error.message : "Check LinkedIn before taking further action." })
      : await repository.blockUnpublishedPublication(publication._id.toString(), leaseId, { status: "blocked", errorCode: error instanceof AppError ? error.code : "SCHEDULE_VALIDATION_FAILED", errorMessage: error instanceof AppError ? error.message : "The scheduled publication could not be authorized." });
    return uncertain ? publicPublication(uncertain) : null;
  }
}

export function startLinkedInSchedulerWorker(intervalMs = 5_000, repository: LinkedInPublicationRepository = defaultRepository, publishingClient: LinkedInPublishingClient = linkedinPublishingClient, clock: () => Date = () => new Date()) {
  if (!env.LINKEDIN_SCHEDULER_ENABLED) return async () => undefined;
  let running = false;
  let stopping = false;
  let active: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (running || stopping) return;
    running = true;
    active = (async () => {
      const now = clock();
      await repository.recoverExpiredDispatch(now);
      const leaseId = randomUUID();
      const claimed = await repository.claimDuePublication(leaseId, new Date(now.getTime() + 120_000), now);
      if (claimed) await dispatchClaimedLinkedInPublication(claimed, leaseId, publishingClient, now, repository);
    })().catch(() => undefined).finally(() => { running = false; active = null; });
  }, intervalMs);
  return async () => {
    stopping = true;
    clearInterval(timer);
    if (active) await active;
  };
}
