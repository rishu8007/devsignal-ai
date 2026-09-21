import { ResearchBriefModel, type ResearchBriefDocument } from "../models/research-brief.model.js";
export function ensureResearchBriefIndexes() { return ResearchBriefModel.createIndexes(); }
export function createResearchBrief(input: Record<string, unknown>) { return ResearchBriefModel.create(input); }
export function findResearchBriefByIdAndOwner(ownerId: string, id: string) { return ResearchBriefModel.findOne({ _id: id, ownerId }).lean<ResearchBriefDocument>().exec(); }
export function findResearchBriefByRequestId(ownerId: string, requestId: string) { return ResearchBriefModel.findOne({ ownerId, requestId }).lean<ResearchBriefDocument>().exec(); }
export function listResearchBriefs(ownerId: string, signalId: string, page: number, limit: number) {
  return Promise.all([
    ResearchBriefModel.find({ ownerId, signalId }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean<ResearchBriefDocument[]>().exec(),
    ResearchBriefModel.countDocuments({ ownerId, signalId }).exec(),
  ]);
}
export function updateResearchBrief(id: string, update: Record<string, unknown>) {
  return ResearchBriefModel.findByIdAndUpdate(id, { $set: update }, { new: true }).lean<ResearchBriefDocument>().exec();
}
