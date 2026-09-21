import { ContentWorkflowModel, type ContentWorkflowDocument } from "../models/content-workflow.model.js";

export function ensureContentWorkflowIndexes(): Promise<void> {
  return ContentWorkflowModel.createIndexes().then(() => undefined);
}
export function createContentWorkflow(input: Record<string, unknown>) {
  return ContentWorkflowModel.create(input);
}
export function findContentWorkflowByIdAndOwner(ownerId: string, id: string) {
  return ContentWorkflowModel.findOne({ _id: id, ownerId }).lean<ContentWorkflowDocument>().exec();
}
export function findContentWorkflowByRequestId(ownerId: string, requestId: string) {
  return ContentWorkflowModel.findOne({ ownerId, requestId }).lean<ContentWorkflowDocument>().exec();
}
export function listContentWorkflows(ownerId: string, signalId: string) {
  return ContentWorkflowModel.find({ ownerId, signalId }).sort({ createdAt: -1, _id: -1 }).limit(20).lean<ContentWorkflowDocument[]>().exec();
}
export function updateContentWorkflow(id: string, update: Record<string, unknown>) {
  return ContentWorkflowModel.findByIdAndUpdate(id, { $set: update }, { new: true }).lean<ContentWorkflowDocument>().exec();
}
export function claimContentWorkflowApproval(id: string, update: Record<string, unknown>) {
  return ContentWorkflowModel.findOneAndUpdate(
    { _id: id, status: "awaiting_approval", cancellationRequested: false },
    { $set: update },
    { new: true },
  ).lean<ContentWorkflowDocument>().exec();
}
export function updateClaimedContentWorkflow(id: string, leaseId: string, update: Record<string, unknown>) {
  return ContentWorkflowModel.findOneAndUpdate(
    { _id: id, status: "running", leaseId },
    { $set: update },
    { new: true },
  ).lean<ContentWorkflowDocument>().exec();
}
export function claimNextContentWorkflow(leaseId: string, expiresAt: Date) {
  return ContentWorkflowModel.findOneAndUpdate(
    { status: "queued", cancellationRequested: false },
    { $set: { status: "running", leaseId, leaseExpiresAt: expiresAt, updatedAt: new Date() } },
    { sort: { createdAt: 1, _id: 1 }, new: true },
  ).lean<ContentWorkflowDocument>().exec();
}
export function markExpiredContentWorkflowsUncertain(now: Date) {
  return ContentWorkflowModel.updateMany(
    { status: "running", leaseExpiresAt: { $lt: now } },
    { $set: { status: "uncertain", errorCode: "WORKER_INTERRUPTED", leaseId: null, leaseExpiresAt: null, updatedAt: now } },
  ).exec();
}
