import { LinkedInConnectionModel, type LinkedInConnectionDocument } from "../models/linkedin-connection.model.js";
import { LinkedInOauthStateModel, type LinkedInOauthStateDocument } from "../models/linkedin-oauth-state.model.js";

export function ensureLinkedInIndexes(): Promise<void> {
  return Promise.all([LinkedInConnectionModel.createIndexes(), LinkedInOauthStateModel.createIndexes()]).then(() => undefined);
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
