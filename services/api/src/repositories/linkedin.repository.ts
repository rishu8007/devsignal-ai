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

export function claimLinkedInPublication(id: string, now: Date) {
  return LinkedInPublicationModel.findOneAndUpdate(
    { _id: id, status: "pending", previewExpiresAt: { $gt: now } },
    { $set: { status: "dispatching", dispatchedAt: now, updatedAt: now } },
    { new: true },
  ).lean<LinkedInPublicationDocument>().exec();
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
