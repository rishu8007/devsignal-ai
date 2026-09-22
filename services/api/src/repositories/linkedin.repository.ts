import { LinkedInConnectionModel, type LinkedInConnectionDocument } from "../models/linkedin-connection.model.js";
import { LinkedInOauthStateModel, type LinkedInOauthStateDocument } from "../models/linkedin-oauth-state.model.js";
import { LinkedInPublicationModel, type LinkedInPublicationDocument } from "../models/linkedin-publication.model.js";

export function ensureLinkedInIndexes(): Promise<void> {
  return Promise.all([
    LinkedInConnectionModel.createIndexes(),
    LinkedInOauthStateModel.createIndexes(),
    LinkedInPublicationModel.createIndexes(),
  ]).then(() => undefined);
}

export function createLinkedInOauthState(input: Record<string, unknown>) {
  return LinkedInOauthStateModel.create(input);
}

export function consumeLinkedInOauthState(stateHash: string, sessionHash: string, now: Date) {
  return LinkedInOauthStateModel.findOneAndUpdate(
    { stateHash, sessionHash, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: true },
  ).lean<LinkedInOauthStateDocument>().exec();
}

export function findLinkedInConnection(ownerId: string) {
  return LinkedInConnectionModel.findOne({ ownerId }).lean<LinkedInConnectionDocument>().exec();
}

export function createLinkedInConnection(input: Record<string, unknown>) {
  return LinkedInConnectionModel.create(input);
}

export function updateLinkedInConnection(ownerId: string, update: Record<string, unknown>) {
  return LinkedInConnectionModel.findOneAndUpdate({ ownerId }, { $set: update }, { new: true }).lean<LinkedInConnectionDocument>().exec();
}

export function disconnectLinkedInConnection(ownerId: string) {
  return LinkedInConnectionModel.findOneAndUpdate(
    { ownerId },
    { $set: { status: "reconnect_required", accessTokenEncrypted: null, refreshTokenEncrypted: null }, $inc: { connectionGeneration: 1 } },
  ).exec();
}

export function findLinkedInPublication(ownerId: string, id: string) {
  return LinkedInPublicationModel.findOne({ ownerId, previewId: id }).lean<LinkedInPublicationDocument>().exec();
}

export function findLinkedInPublicationByOperationKey(ownerId: string, operationKey: string) {
  return LinkedInPublicationModel.findOne({ ownerId, operationKey }).lean<LinkedInPublicationDocument>().exec();
}

export function createLinkedInPublication(input: Record<string, unknown>) {
  return LinkedInPublicationModel.create(input);
}

export function claimLinkedInPublication(id: string, leaseId: string, now: Date) {
  return LinkedInPublicationModel.findOneAndUpdate(
    { _id: id, status: "pending", previewExpiresAt: { $gt: now } },
    { $set: { leaseId, leaseExpiresAt: new Date(now.getTime() + 120_000), updatedAt: now } },
    { new: true },
  ).lean<LinkedInPublicationDocument>().exec();
}

export function authorizeLinkedInPublicationDispatch(id: string, leaseId: string, expectedRevision: number, now: Date) {
  return LinkedInPublicationModel.findOneAndUpdate(
    {
      _id: id,
      status: { $in: ["pending", "scheduled"] },
      leaseId,
      leaseExpiresAt: { $gt: now },
      cancelledAt: null,
      scheduleRevision: expectedRevision,
    },
    { $set: { status: "dispatching", dispatchAuthorizedAt: now, dispatchedAt: now, updatedAt: now } },
    { new: true },
  ).lean<LinkedInPublicationDocument>().exec();
}

export function scheduleLinkedInPublication(id: string, expectedRevision: number, input: Record<string, unknown>) {
  return LinkedInPublicationModel.findOneAndUpdate(
    { _id: id, status: "pending", scheduleRevision: expectedRevision, previewExpiresAt: { $gt: new Date() } },
    { $set: { ...input, status: "scheduled", schedulingAuthorizedAt: new Date() }, $inc: { scheduleRevision: 1 } },
    { new: true },
  ).lean<LinkedInPublicationDocument>().exec();
}

export function cancelLinkedInPublication(id: string, expectedRevision: number, now: Date) {
  return LinkedInPublicationModel.findOneAndUpdate(
    { _id: id, status: { $in: ["scheduled", "pending"] }, scheduleRevision: expectedRevision },
    { $set: { status: "cancelled", cancelledAt: now }, $inc: { scheduleRevision: 1 } },
    { new: true },
  ).lean<LinkedInPublicationDocument>().exec();
}

export function rescheduleLinkedInPublication(id: string, expectedRevision: number, scheduledAt: Date, timezone: string, now: Date) {
  return LinkedInPublicationModel.findOneAndUpdate(
    { _id: id, status: "scheduled", scheduleRevision: expectedRevision },
    { $set: { scheduledAt, scheduledTimezone: timezone, schedulingAuthorizedAt: now }, $inc: { scheduleRevision: 1 } },
    { new: true },
  ).lean<LinkedInPublicationDocument>().exec();
}

export function claimDueLinkedInPublication(leaseId: string, leaseExpiresAt: Date, now: Date) {
  return LinkedInPublicationModel.findOneAndUpdate(
    {
      status: "scheduled",
      scheduledAt: { $lte: now },
      $or: [{ leaseId: null }, { leaseExpiresAt: { $lte: now } }],
    },
    { $set: { leaseId, leaseExpiresAt, updatedAt: now } },
    { sort: { scheduledAt: 1, _id: 1 }, new: true },
  ).lean<LinkedInPublicationDocument>().exec();
}

export function fenceLinkedInPublication(id: string, leaseId: string, update: Record<string, unknown>) {
  return LinkedInPublicationModel.findOneAndUpdate(
    { _id: id, status: "dispatching", leaseId },
    { $set: update, $unset: { leaseId: 1, leaseExpiresAt: 1 } },
    { new: true },
  ).lean<LinkedInPublicationDocument>().exec();
}

export function blockUnpublishedLinkedInPublication(id: string, leaseId: string, update: Record<string, unknown>) {
  return LinkedInPublicationModel.findOneAndUpdate(
    { _id: id, status: "scheduled", leaseId, dispatchAuthorizedAt: null },
    { $set: update, $unset: { leaseId: 1, leaseExpiresAt: 1 } },
    { new: true },
  ).lean<LinkedInPublicationDocument>().exec();
}

export function recoverExpiredLinkedInDispatch(now: Date) {
  return LinkedInPublicationModel.findOneAndUpdate(
    { status: "dispatching", leaseExpiresAt: { $lte: now } },
    {
      $set: {
        status: "uncertain",
        errorCode: "DISPATCH_LEASE_EXPIRED",
        errorMessage: "Dispatch may have reached LinkedIn. Check LinkedIn before taking further action.",
      },
      $unset: { leaseId: 1, leaseExpiresAt: 1 },
    },
    { sort: { dispatchedAt: 1, _id: 1 }, new: true },
  ).lean<LinkedInPublicationDocument>().exec();
}

export function listDueLinkedInPublications(now: Date) {
  return LinkedInPublicationModel.find({ status: "scheduled", scheduledAt: { $lte: now } })
    .sort({ scheduledAt: 1, _id: 1 }).limit(10).lean<LinkedInPublicationDocument[]>().exec();
}

export function updateLinkedInPublication(id: string, update: Record<string, unknown>) {
  return LinkedInPublicationModel.findByIdAndUpdate(id, { $set: update }, { new: true })
    .lean<LinkedInPublicationDocument>()
    .exec();
}

export function listLinkedInPublications(ownerId: string) {
  return LinkedInPublicationModel.find({ ownerId }).sort({ createdAt: -1, _id: -1 }).limit(50)
    .lean<LinkedInPublicationDocument[]>()
    .exec();
}
