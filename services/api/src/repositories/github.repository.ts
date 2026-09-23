import { GithubActivityModel } from "../models/github-activity.model.js";
import { Types } from "mongoose";
import { GithubConnectionModel } from "../models/github-connection.model.js";
import { GithubOauthStateModel } from "../models/github-oauth-state.model.js";

export function ensureGithubIndexes() { return Promise.all([GithubConnectionModel.createIndexes(), GithubOauthStateModel.createIndexes(), GithubActivityModel.createIndexes()]).then(() => undefined); }
export function findGithubConnection(ownerId: string) { return GithubConnectionModel.findOne({ ownerId }).lean().exec(); }
export function listGithubConnections() { return GithubConnectionModel.find({ status: "connected" }).lean().exec(); }
export function createGithubConnection(input: Record<string, unknown>) { return GithubConnectionModel.create(input); }
export function updateGithubConnection(ownerId: string, update: Record<string, unknown>) { return GithubConnectionModel.findOneAndUpdate({ ownerId }, { $set: update }, { new: true }).lean().exec(); }
export function claimGithubSync(ownerId: string, now: Date) { return GithubConnectionModel.findOneAndUpdate({ ownerId, status: "connected", "sync.status": { $ne: "syncing" }, $or: [{ "sync.nextEligibleAt": null }, { "sync.nextEligibleAt": { $lte: now } }] }, { $set: { "sync.status": "syncing", "sync.lastError": null, "sync.startedAt": now } }, { new: true }).lean().exec(); }
export function disconnectGithubConnection(ownerId: string) { return GithubConnectionModel.findOneAndUpdate({ ownerId }, { $set: { status: "revoked", accessTokenEncrypted: "" }, $inc: { connectionGeneration: 1 } }).exec(); }
export function createGithubOauthState(input: Record<string, unknown>) { return GithubOauthStateModel.create(input); }
export function consumeGithubOauthState(stateHash: string, sessionHash: string, now: Date) { return GithubOauthStateModel.findOneAndUpdate({ stateHash, sessionHash, usedAt: null, expiresAt: { $gt: now } }, { $set: { usedAt: now } }, { new: true }).lean().exec(); }
export function findGithubOauthState(stateHash: string, sessionHash: string, now: Date) { return GithubOauthStateModel.findOne({ stateHash, sessionHash, usedAt: null, expiresAt: { $gt: now } }).lean().exec(); }
export function setGithubOauthInstallation(stateHash: string, sessionHash: string, installationId: number) { return GithubOauthStateModel.updateOne({ stateHash, sessionHash, usedAt: null }, { $set: { pendingInstallationId: installationId } }).exec(); }
export function listGithubActivities(ownerId: string, kind?: "commit" | "pull_request" | "release", repositoryId?: number, page = 1) {
  const owner = new Types.ObjectId(ownerId);
  const filter: Record<string, unknown> = { ownerId: owner };
  if (kind) filter.kind = kind;
  if (repositoryId) filter.repositoryId = repositoryId;
  return GithubActivityModel.find(filter).sort({ occurredAt: -1, _id: -1 }).skip((page - 1) * 100).limit(100).lean().exec();
}
export function upsertGithubActivity(input: Record<string, unknown>) { return GithubActivityModel.findOneAndUpdate({ ownerId: new Types.ObjectId(String(input.ownerId)), repositoryId: input.repositoryId, kind: input.kind, providerId: input.providerId } as Record<string, unknown>, { $setOnInsert: input }, { upsert: true, new: true }).lean().exec(); }
export function markGithubActivitySignal(ownerId: string, id: string, signalId: string) { return GithubActivityModel.findOneAndUpdate({ _id: new Types.ObjectId(id), ownerId: new Types.ObjectId(ownerId), convertedSignalId: null } as Record<string, unknown>, { $set: { convertedSignalId: new Types.ObjectId(signalId), conversionClaim: null, conversionClaimedAt: null } }, { new: true }).lean().exec(); }
export function claimGithubActivityConversion(ownerId: string, id: string, claim: string, now = new Date()) { return GithubActivityModel.findOneAndUpdate({ _id: new Types.ObjectId(id), ownerId: new Types.ObjectId(ownerId), convertedSignalId: null, $or: [{ conversionClaim: null }, { conversionClaimedAt: { $lte: new Date(now.getTime() - 5 * 60_000) } }] } as Record<string, unknown>, { $set: { conversionClaim: claim, conversionClaimedAt: now } }, { new: true }).lean().exec(); }
export function releaseGithubActivityConversion(ownerId: string, id: string, claim: string) { return GithubActivityModel.updateOne({ _id: new Types.ObjectId(id), ownerId: new Types.ObjectId(ownerId), conversionClaim: claim } as Record<string, unknown>, { $set: { conversionClaim: null, conversionClaimedAt: null } }).exec(); }
