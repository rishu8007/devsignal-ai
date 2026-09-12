import { Types } from "mongoose";
import {
  GenerationModel,
  type GenerationDocument,
} from "../models/generation.model.js";
import type { DraftListResult, DraftStatus } from "../types/draft.js";
import type { GenerationSource, AiGenerationResult } from "../types/generation.js";

export function ensureGenerationIndexes(): Promise<void> {
  return GenerationModel.createIndexes().then(() => undefined);
}

export function findGenerationByOwnerAndSignal(
  ownerId: string,
  signalId: string,
): Promise<GenerationDocument | null> {
  return GenerationModel.findOne({ ownerId, signalId }).lean<GenerationDocument>().exec();
}

export function createGeneration(
  ownerId: string,
  signalId: string,
  source: GenerationSource,
  result: AiGenerationResult,
): Promise<GenerationDocument> {
  return GenerationModel.create({
    ownerId,
    signalId,
    source,
    model: result.model,
    variations: result.variations.map((variation) => ({
      angle: variation.angle,
      content: variation.content,
      status: "draft",
      scheduledFor: null,
    })),
  });
}

export function updateGenerationVariation(
  ownerId: string,
  signalId: string,
  variationId: string,
  update: {
    content?: string;
    status: "draft" | "approved";
    scheduledFor?: Date | null;
  },
): Promise<GenerationDocument | null> {
  const fields: Record<string, string | Date | null> = {
    "variations.$.status": update.status,
    updatedAt: new Date(),
  };
  if (update.content !== undefined) {
    fields["variations.$.content"] = update.content;
  }
  if (update.scheduledFor !== undefined) {
    fields["variations.$.scheduledFor"] = update.scheduledFor;
  }

  return GenerationModel.findOneAndUpdate(
    {
      ownerId,
      signalId,
      "variations._id": variationId,
    },
    { $set: fields },
    { new: true, runValidators: true },
  )
    .lean<GenerationDocument>()
    .exec();
}

export function scheduleGenerationVariation(
  ownerId: string,
  signalId: string,
  variationId: string,
  scheduledFor: Date,
): Promise<GenerationDocument | null> {
  return GenerationModel.findOneAndUpdate(
    {
      ownerId,
      signalId,
      "variations._id": variationId,
      variations: { $elemMatch: { _id: variationId, status: "approved" } },
    },
    {
      $set: {
        "variations.$.scheduledFor": scheduledFor,
        updatedAt: new Date(),
      },
    },
    { new: true, runValidators: true },
  )
    .lean<GenerationDocument>()
    .exec();
}

export function clearGenerationVariationSchedule(
  ownerId: string,
  signalId: string,
  variationId: string,
): Promise<GenerationDocument | null> {
  return GenerationModel.findOneAndUpdate(
    { ownerId, signalId, "variations._id": variationId },
    {
      $set: {
        "variations.$.scheduledFor": null,
        updatedAt: new Date(),
      },
    },
    { new: true, runValidators: true },
  )
    .lean<GenerationDocument>()
    .exec();
}

interface DraftAggregationRow {
  _id: Types.ObjectId;
  generationId: Types.ObjectId;
  signalId: Types.ObjectId;
  topic: string;
  angle: string;
  content: string;
  status: DraftStatus;
  generationUpdatedAt: Date;
  scheduledFor: Date | null;
}

interface DraftCountRow {
  count: number;
}

interface DraftSummaryRow {
  _id: DraftStatus;
  count: number;
}

interface ScheduledSummaryRow {
  count: number;
}

interface DraftAggregationResult {
  drafts: DraftAggregationRow[];
  total: DraftCountRow[];
  summary: DraftSummaryRow[];
  scheduled: ScheduledSummaryRow[];
}

export async function listDraftsByOwner(
  ownerId: string,
  page: number,
  limit: number,
  status?: DraftStatus,
): Promise<DraftListResult> {
  const matchStatus = status ? [{ $match: { "variations.status": status } }] : [];
  const [result] = await GenerationModel.aggregate<DraftAggregationResult>([
    { $match: { ownerId: new Types.ObjectId(ownerId) } },
    {
      $facet: {
        drafts: [
          { $unwind: "$variations" },
          ...matchStatus,
          {
            $sort: {
              updatedAt: -1,
              _id: -1,
              "variations._id": -1,
            },
          },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $project: {
              _id: "$variations._id",
              generationId: "$_id",
              signalId: 1,
              topic: "$source.topic",
              angle: "$variations.angle",
              content: "$variations.content",
              status: "$variations.status",
              scheduledFor: "$variations.scheduledFor",
              generationUpdatedAt: "$updatedAt",
            },
          },
        ],
        total: [
          { $unwind: "$variations" },
          ...matchStatus,
          { $count: "count" },
        ],
        summary: [
          { $unwind: "$variations" },
          {
            $group: {
              _id: "$variations.status",
              count: { $sum: 1 },
            },
          },
        ],
        scheduled: [
          { $unwind: "$variations" },
          {
            $match: {
              "variations.status": "approved",
              "variations.scheduledFor": { $type: "date" },
            },
          },
          { $count: "count" },
        ],
      },
    },
  ]).exec();

  const summary = { draft: 0, approved: 0, scheduled: 0 };
  for (const item of result?.summary ?? []) {
    summary[item._id] = item.count;
  }
  summary.scheduled = result?.scheduled[0]?.count ?? 0;

  return {
    drafts: (result?.drafts ?? []).map((draft) => ({
      id: draft._id.toString(),
      generationId: draft.generationId.toString(),
      signalId: draft.signalId.toString(),
      topic: draft.topic,
      angle: draft.angle as DraftListResult["drafts"][number]["angle"],
      content: draft.content,
      status: draft.status,
      scheduledFor: draft.scheduledFor ?? null,
      generationUpdatedAt: draft.generationUpdatedAt,
    })),
    total: result?.total[0]?.count ?? 0,
    summary: {
      ...summary,
      total: summary.draft + summary.approved,
    },
  };
}

export interface CalendarListResult {
  items: Array<{
    id: string;
    generationId: string;
    signalId: string;
    topic: string;
    angle: "technical_depth" | "learning_story" | "professional_impact";
    content: string;
    status: "approved";
    scheduledFor: Date;
  }>;
  total: number;
}

interface CalendarAggregationResult {
  items: Array<{
    _id: Types.ObjectId;
    generationId: Types.ObjectId;
    signalId: Types.ObjectId;
    topic: string;
    angle: "technical_depth" | "learning_story" | "professional_impact";
    content: string;
    status: "approved";
    scheduledFor: Date;
  }>;
  total: DraftCountRow[];
}

export async function listCalendarByOwner(
  ownerId: string,
  from: Date,
  to: Date,
  page: number,
  limit: number,
): Promise<CalendarListResult> {
  const [result] = await GenerationModel.aggregate<CalendarAggregationResult>([
    { $match: { ownerId: new Types.ObjectId(ownerId) } },
    { $unwind: "$variations" },
    {
      $match: {
        "variations.status": "approved",
        "variations.scheduledFor": { $gte: from, $lt: to },
      },
    },
    {
      $facet: {
        items: [
          {
            $sort: {
              "variations.scheduledFor": 1,
              _id: 1,
              "variations._id": 1,
            },
          },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $project: {
              _id: "$variations._id",
              generationId: "$_id",
              signalId: 1,
              topic: "$source.topic",
              angle: "$variations.angle",
              content: "$variations.content",
              status: "$variations.status",
              scheduledFor: "$variations.scheduledFor",
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]).exec();

  return {
    items: (result?.items ?? []).map((item) => ({
      id: item._id.toString(),
      generationId: item.generationId.toString(),
      signalId: item.signalId.toString(),
      topic: item.topic,
      angle: item.angle,
      content: item.content,
      status: item.status,
      scheduledFor: item.scheduledFor,
    })),
    total: result?.total[0]?.count ?? 0,
  };
}
