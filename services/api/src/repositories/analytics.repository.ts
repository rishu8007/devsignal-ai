import { Types } from "mongoose";
import { SignalModel } from "../models/signal.model.js";
import { GenerationModel } from "../models/generation.model.js";
import { LinkedInPublicationModel, type LinkedInPublicationDocument } from "../models/linkedin-publication.model.js";
import { DraftReviewModel } from "../models/draft-review.model.js";
import { ResearchBriefModel } from "../models/research-brief.model.js";
import { KnowledgeSourceModel } from "../models/knowledge-source.model.js";
import { EngagementSnapshotModel, type EngagementSnapshotDocument } from "../models/engagement-snapshot.model.js";
import { calculateDraftQualityScore, DRAFT_QUALITY_RUBRIC_VERSION } from "../services/draft-quality-rubric.js";

const reviewPopulationLimit = 1000;

export function ensureAnalyticsIndexes(): Promise<void> {
  return EngagementSnapshotModel.createIndexes().then(() => undefined);
}

export function createEngagementSnapshot(ownerId: string, input: Record<string, unknown>) {
  return EngagementSnapshotModel.create({ ownerId, ...input });
}

export function findEngagementSnapshot(ownerId: string, id: string) {
  return EngagementSnapshotModel.findOne({ _id: id, ownerId }).lean<EngagementSnapshotDocument>().exec();
}

export function updateEngagementSnapshot(ownerId: string, id: string, expectedRevision: number, update: Record<string, unknown>) {
  return EngagementSnapshotModel.findOneAndUpdate(
    { _id: id, ownerId, revision: expectedRevision },
    { $set: update, $inc: { revision: 1 } },
    { new: true, runValidators: true },
  ).lean<EngagementSnapshotDocument>().exec();
}

export function deleteEngagementSnapshot(ownerId: string, id: string, expectedRevision: number) {
  return EngagementSnapshotModel.findOneAndDelete({ _id: id, ownerId, revision: expectedRevision }).lean<EngagementSnapshotDocument>().exec();
}

export function listEngagementSnapshots(ownerId: string, publicationIds: string[], through: Date) {
  return EngagementSnapshotModel.find({ ownerId, publicationId: { $in: publicationIds }, observedAt: { $lte: through } })
    .sort({ publicationId: 1, observedAt: -1, _id: -1 })
    .lean<EngagementSnapshotDocument[]>()
    .exec();
}

export interface AnalyticsRepository {
  countSignals(ownerId: string, from: Date, to: Date): Promise<number>;
  countGenerations(ownerId: string, from: Date, to: Date): Promise<number>;
  approvedCount(ownerId: string): Promise<number>;
  scheduledCount(ownerId: string): Promise<number>;
  publicationSummary(ownerId: string, from: Date, to: Date): Promise<Record<string, number>>;
  topicSummary(ownerId: string, from: Date, to: Date, through: Date): Promise<Array<{ topic: string; publications: number; engagementPosts: number; impressions: number; reactions: number; comments: number; reposts: number; rateNumerator: number; rateDenominator: number; rateEligiblePosts: number }>>;
  publishedPosts(ownerId: string, from: Date, to: Date, skip: number, limit: number): Promise<Array<{ publicationId: string; topic: string; publishedAt: Date; text: string }>>;
  reviewSummary(ownerId: string, from: Date, to: Date): Promise<{ assessed: number; unassessed: number; outdated: number; averageScore: number | null; rubricVersion: string; severities: Record<string, number>; categories: Record<string, number>; suggestions: Array<{ text: string; count: number }>; population: number; populationLimit: number; truncated: boolean; reviewQueryTruncated: boolean }>;
  snapshots(ownerId: string, publicationIds: string[], through: Date): Promise<EngagementSnapshotDocument[]>;
  findPublication(ownerId: string, publicationId: string): Promise<LinkedInPublicationDocument | null>;
  createSnapshot(ownerId: string, input: Record<string, unknown>): Promise<EngagementSnapshotDocument>;
  findSnapshot(ownerId: string, id: string): Promise<EngagementSnapshotDocument | null>;
  updateSnapshot(ownerId: string, id: string, expectedRevision: number, update: Record<string, unknown>): Promise<EngagementSnapshotDocument | null>;
  deleteSnapshot(ownerId: string, id: string, expectedRevision: number): Promise<EngagementSnapshotDocument | null>;
}

export const defaultAnalyticsRepository: AnalyticsRepository = {
  countSignals: (ownerId, from, to) => SignalModel.countDocuments({ ownerId, createdAt: { $gte: from, $lt: to } }).exec(),
  countGenerations: (ownerId, from, to) => GenerationModel.countDocuments({ ownerId, createdAt: { $gte: from, $lt: to } }).exec(),
  approvedCount: async (ownerId) => {
    const [row] = await GenerationModel.aggregate<{ count: number }>([
      { $match: { ownerId: new Types.ObjectId(ownerId) } },
      { $unwind: "$variations" },
      { $match: { "variations.status": "approved" } },
      { $count: "count" },
    ]).exec();
    return row?.count ?? 0;
  },
  scheduledCount: (ownerId) => LinkedInPublicationModel.countDocuments({ ownerId, status: "scheduled" }).exec(),
  publicationSummary: async (ownerId, from, to) => {
    const rows = await LinkedInPublicationModel.aggregate<{ _id: string; count: number }>([
      { $match: { ownerId: new Types.ObjectId(ownerId), updatedAt: { $gte: from, $lt: to }, status: { $in: ["published", "rejected", "blocked", "missed", "uncertain"] } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).exec();
    return Object.fromEntries(rows.map((row) => [row._id, row.count]));
  },
  topicSummary: async (ownerId, from, to, through) => {
    return LinkedInPublicationModel.aggregate<{ topic: string; publications: number; engagementPosts: number; impressions: number; reactions: number; comments: number; reposts: number; rateNumerator: number; rateDenominator: number; rateEligiblePosts: number }>([
      { $match: { ownerId: new Types.ObjectId(ownerId), status: "published", publishedAt: { $gte: from, $lt: to } } },
      { $lookup: { from: "signals", localField: "signalId", foreignField: "_id", as: "signal" } },
      { $unwind: "$signal" },
      { $lookup: {
        from: "linkedinEngagementSnapshots",
        let: { publication: "$previewId", owner: "$ownerId", published: "$publishedAt" },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ["$publicationId", "$$publication"] },
            { $eq: ["$ownerId", "$$owner"] },
            { $lte: ["$observedAt", through] },
            { $gte: ["$observedAt", "$$published"] },
          ] } } },
          { $sort: { observedAt: -1, _id: -1 } },
          { $limit: 1 },
        ],
        as: "engagement",
      } },
      { $unwind: { path: "$engagement", preserveNullAndEmptyArrays: true } },
      { $group: {
        _id: "$signal.topic",
        publications: { $sum: 1 },
        engagementPosts: { $sum: { $cond: [{ $ne: [{ $type: "$engagement._id" }, "missing"] }, 1, 0] } },
        impressions: { $sum: { $ifNull: ["$engagement.impressions", 0] } },
        reactions: { $sum: { $ifNull: ["$engagement.reactions", 0] } },
        comments: { $sum: { $ifNull: ["$engagement.comments", 0] } },
        reposts: { $sum: { $ifNull: ["$engagement.reposts", 0] } },
        rateNumerator: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ["$engagement.impressions", 0] },
                  { $ne: [{ $type: "$engagement.reactions" }, "missing"] },
                  { $ne: ["$engagement.reactions", null] },
                  { $ne: [{ $type: "$engagement.comments" }, "missing"] },
                  { $ne: ["$engagement.comments", null] },
                  { $ne: [{ $type: "$engagement.reposts" }, "missing"] },
                  { $ne: ["$engagement.reposts", null] },
                ],
              },
              { $add: ["$engagement.reactions", "$engagement.comments", "$engagement.reposts"] },
              0,
            ],
          },
        },
        rateDenominator: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ["$engagement.impressions", 0] },
                  { $ne: [{ $type: "$engagement.reactions" }, "missing"] },
                  { $ne: ["$engagement.reactions", null] },
                  { $ne: [{ $type: "$engagement.comments" }, "missing"] },
                  { $ne: ["$engagement.comments", null] },
                  { $ne: [{ $type: "$engagement.reposts" }, "missing"] },
                  { $ne: ["$engagement.reposts", null] },
                ],
              },
              "$engagement.impressions",
              0,
            ],
          },
        },
        rateEligiblePosts: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ["$engagement.impressions", 0] },
                  { $ne: [{ $type: "$engagement.reactions" }, "missing"] },
                  { $ne: ["$engagement.reactions", null] },
                  { $ne: [{ $type: "$engagement.comments" }, "missing"] },
                  { $ne: ["$engagement.comments", null] },
                  { $ne: [{ $type: "$engagement.reposts" }, "missing"] },
                  { $ne: ["$engagement.reposts", null] },
                ],
              },
              1,
              0,
            ],
          },
        },
      } },
      { $project: { _id: 0, topic: "$_id", publications: 1, engagementPosts: 1, impressions: 1, reactions: 1, comments: 1, reposts: 1, rateNumerator: 1, rateDenominator: 1, rateEligiblePosts: 1 } },
      { $sort: { topic: 1 } },
    ]).exec();
  },
  publishedPosts: async (ownerId, from, to, skip, limit) => {
    const rows = await LinkedInPublicationModel.aggregate<{ publicationId: string; topic: string; publishedAt: Date; text: string }>([
      { $match: { ownerId: new Types.ObjectId(ownerId), status: "published", publishedAt: { $gte: from, $lt: to } } },
      { $lookup: { from: "signals", localField: "signalId", foreignField: "_id", as: "signal" } },
      { $unwind: "$signal" },
      { $sort: { publishedAt: -1, _id: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { _id: 0, publicationId: "$previewId", topic: "$signal.topic", publishedAt: 1, text: "$textSnapshot" } },
    ]).exec();
    return rows;
  },
  reviewSummary: async (ownerId, from, to) => {
    const generations = await GenerationModel.find({ ownerId: new Types.ObjectId(ownerId), createdAt: { $gte: from, $lt: to } })
      .sort({ createdAt: 1, _id: 1 }).limit(reviewPopulationLimit + 1).lean().exec();
    const truncated = generations.length > reviewPopulationLimit;
    const boundedGenerations = generations.slice(0, reviewPopulationLimit);
    const keys = boundedGenerations.flatMap((generation) => generation.variations.map((variation) => ({
      signalId: generation.signalId.toString(), generationId: generation._id.toString(), variationId: variation._id.toString(), content: variation.content,
    })));
    const reviews = await DraftReviewModel.find({ ownerId: new Types.ObjectId(ownerId), signalId: { $in: boundedGenerations.map((generation) => generation.signalId) } })
      .sort({ createdAt: -1, _id: -1 }).limit(reviewPopulationLimit * 3).lean().exec();
    const reviewQueryTruncated = reviews.length >= reviewPopulationLimit * 3;
    const latest = new Map<string, typeof reviews[number]>();
    for (const review of reviews) {
      const key = `${review.signalId}:${review.generationId}:${review.variationId}`;
      if (!latest.has(key)) latest.set(key, review);
    }
    const briefIds = [...new Set([...latest.values()].map((review) => review.researchBriefId.toString()))];
    const briefs = await ResearchBriefModel.find({ ownerId: new Types.ObjectId(ownerId), _id: { $in: briefIds } }).lean().exec();
    const sourceIds = [...new Set(briefs.flatMap((brief) => brief.sourceVersions.map((source) => source.sourceId)))];
    const sources = await KnowledgeSourceModel.find({ ownerId: new Types.ObjectId(ownerId), _id: { $in: sourceIds } }).lean().exec();
    const sourceMap = new Map(sources.map((source) => [source._id.toString(), source]));
    const briefMap = new Map(briefs.map((brief) => [brief._id.toString(), brief]));
    const severities: Record<string, number> = {};
    const categories: Record<string, number> = {};
    const suggestionCounts = new Map<string, number>();
    const scores: number[] = [];
    let assessed = 0;
    let outdated = 0;
    let unassessed = 0;
    for (const key of keys) {
      const review = latest.get(`${key.signalId}:${key.generationId}:${key.variationId}`);
      if (!review) {
        unassessed += 1;
        continue;
      }
      const brief = briefMap.get(review.researchBriefId.toString());
      const evidenceCurrent = Boolean(brief && !brief.stale && brief.sourceVersions.every((item) => typeof item.sourceId === "string" && typeof item.contentVersion === "number" && (() => {
        const source = sourceMap.get(item.sourceId);
        return source?.processingStatus === "indexed" && source.indexedContentVersion === source.contentVersion && source.contentVersion === item.contentVersion;
      })()));
      if (review.status !== "succeeded") {
        unassessed += 1;
        continue;
      }
      const current = review.status === "succeeded" && !review.stale && review.draftContent === key.content && evidenceCurrent;
      if (!current) {
        outdated += 1;
        continue;
      }
      const score = typeof review.qualityScore === "number" ? review.qualityScore : calculateDraftQualityScore(review.draftContent, review.findings);
      assessed += 1;
      scores.push(score);
      for (const finding of review.findings) {
        severities[finding.severity] = (severities[finding.severity] ?? 0) + 1;
        categories[finding.category] = (categories[finding.category] ?? 0) + 1;
        if (finding.suggestion) suggestionCounts.set(finding.suggestion, (suggestionCounts.get(finding.suggestion) ?? 0) + 1);
      }
    }
    return {
      assessed, unassessed, outdated, averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
      rubricVersion: DRAFT_QUALITY_RUBRIC_VERSION, severities, categories,
      suggestions: [...suggestionCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([text, count]) => ({ text, count })),
      population: keys.length, populationLimit: reviewPopulationLimit, truncated, reviewQueryTruncated,
    };
  },
  snapshots: listEngagementSnapshots,
  findPublication: (ownerId, publicationId) => LinkedInPublicationModel.findOne({ ownerId, previewId: publicationId, status: "published" }).lean<LinkedInPublicationDocument>().exec(),
  createSnapshot: createEngagementSnapshot,
  findSnapshot: findEngagementSnapshot,
  updateSnapshot: updateEngagementSnapshot,
  deleteSnapshot: deleteEngagementSnapshot,
};
