import { Types } from "mongoose";
import { SignalModel } from "../models/signal.model.js";
import { GenerationModel } from "../models/generation.model.js";
import { LinkedInPublicationModel, type LinkedInPublicationDocument } from "../models/linkedin-publication.model.js";
import { DraftReviewModel } from "../models/draft-review.model.js";
import { EngagementSnapshotModel, type EngagementSnapshotDocument } from "../models/engagement-snapshot.model.js";

interface ReviewSummaryAggregation {
  population: Array<{ population: number }>;
  severities: Array<{ _id: string; count: number }>;
  categories: Array<{ _id: string; count: number }>;
}

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
  reviewSummary(ownerId: string, from: Date, to: Date): Promise<{ population: number; severities: Record<string, number>; categories: Record<string, number> }>;
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
    const rows = await DraftReviewModel.aggregate<ReviewSummaryAggregation>([
      { $match: { ownerId: new Types.ObjectId(ownerId), status: "succeeded", stale: false, createdAt: { $gte: from, $lt: to } } },
      { $sort: { signalId: 1, variationId: 1, createdAt: -1, _id: -1 } },
      { $group: { _id: { signalId: "$signalId", variationId: "$variationId" }, review: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$review" } },
      { $unwind: { path: "$findings", preserveNullAndEmptyArrays: true } },
      { $facet: {
        population: [{ $group: { _id: null, values: { $addToSet: { signalId: "$signalId", variationId: "$variationId" } } } }, { $project: { _id: 0, population: { $size: "$values" } } }],
        severities: [{ $match: { "findings.severity": { $type: "string" } } }, { $group: { _id: "$findings.severity", count: { $sum: 1 } } }],
        categories: [{ $match: { "findings.category": { $type: "string" } } }, { $group: { _id: "$findings.category", count: { $sum: 1 } } }],
      } },
    ]).exec();
    const row = rows[0];
    return {
      population: row?.population[0]?.population ?? 0,
      severities: Object.fromEntries((row?.severities ?? []).map((item) => [item._id, item.count])),
      categories: Object.fromEntries((row?.categories ?? []).map((item) => [item._id, item.count])),
    };
  },
  snapshots: listEngagementSnapshots,
  findPublication: (ownerId, publicationId) => LinkedInPublicationModel.findOne({ ownerId, previewId: publicationId, status: "published" }).lean<LinkedInPublicationDocument>().exec(),
  createSnapshot: createEngagementSnapshot,
  findSnapshot: findEngagementSnapshot,
  updateSnapshot: updateEngagementSnapshot,
  deleteSnapshot: deleteEngagementSnapshot,
};
