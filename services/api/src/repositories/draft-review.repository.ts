import { DraftReviewModel, type DraftReviewDocument } from "../models/draft-review.model.js";

export function ensureDraftReviewIndexes(): Promise<void> {
  return DraftReviewModel.createIndexes().then(() => undefined);
}
export function createDraftReview(input: Record<string, unknown>) {
  return DraftReviewModel.create(input);
}
export function findDraftReviewByIdAndOwner(ownerId: string, id: string) {
  return DraftReviewModel.findOne({ _id: id, ownerId }).lean<DraftReviewDocument>().exec();
}
export function findDraftReviewByRequestId(ownerId: string, requestId: string) {
  return DraftReviewModel.findOne({ ownerId, requestId }).lean<DraftReviewDocument>().exec();
}
export function listDraftReviews(ownerId: string, signalId: string, variationId: string) {
  return DraftReviewModel.find({ ownerId, signalId, variationId }).sort({ createdAt: -1, _id: -1 }).limit(20).lean<DraftReviewDocument[]>().exec();
}
export function updateDraftReview(id: string, update: Record<string, unknown>) {
  return DraftReviewModel.findByIdAndUpdate(id, { $set: update }, { new: true }).lean<DraftReviewDocument>().exec();
}
