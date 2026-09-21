import { TopicPlanningModel, type TopicPlanningDocument } from "../models/topic-planning.model.js";
export function createTopicPlanningRun(input: Record<string, unknown>) { return TopicPlanningModel.create(input); }
export function findTopicPlanningByIdAndOwner(ownerId: string, runId: string) { return TopicPlanningModel.findOne({ _id: runId, ownerId }).lean<TopicPlanningDocument>().exec(); }
export function findTopicPlanningByRequestId(ownerId: string, requestId: string) { return TopicPlanningModel.findOne({ ownerId, requestId }).lean<TopicPlanningDocument>().exec(); }
export function listTopicPlanningByOwner(ownerId: string, page: number, limit: number) {
  return Promise.all([
    TopicPlanningModel.find({ ownerId }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean<TopicPlanningDocument[]>().exec(),
    TopicPlanningModel.countDocuments({ ownerId }).exec(),
  ]);
}
export function updateTopicPlanningRun(runId: string, update: Record<string, unknown>) {
  return TopicPlanningModel.findByIdAndUpdate(runId, { $set: update }, { new: true }).lean<TopicPlanningDocument>().exec();
}
export function markTopicSuggestionConverted(ownerId: string, runId: string, suggestionId: string) {
  return TopicPlanningModel.findOneAndUpdate({ _id: runId, ownerId, convertedSuggestionIds: { $ne: suggestionId } }, { $addToSet: { convertedSuggestionIds: suggestionId } }, { new: true }).lean<TopicPlanningDocument>().exec();
}
