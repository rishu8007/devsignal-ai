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
    })),
  });
}

export function updateGenerationVariation(
  ownerId: string,
  signalId: string,
  variationId: string,
  update: { content?: string; status: "draft" | "approved" },
): Promise<GenerationDocument | null> {
  const fields: Record<string, string | Date> = {
    "variations.$.status": update.status,
    updatedAt: new Date(),
  };
  if (update.content !== undefined) {
    fields["variations.$.content"] = update.content;
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

interface DraftAggregationRow {
  _id: Types.ObjectId;
  generationId: Types.ObjectId;
  signalId: Types.ObjectId;
  topic: string;
  angle: string;
  content: string;
  status: DraftStatus;
  generationUpdatedAt: Date;
}

interface DraftCountRow {
  count: number;
}

interface DraftSummaryRow {
  _id: DraftStatus;
  count: number;
}

interface DraftAggregationResult {
  drafts: DraftAggregationRow[];
  total: DraftCountRow[];
  summary: DraftSummaryRow[];
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
      },
    },
  ]).exec();

  const summary = { draft: 0, approved: 0 };
  for (const item of result?.summary ?? []) {
    summary[item._id] = item.count;
  }

  return {
    drafts: (result?.drafts ?? []).map((draft) => ({
      id: draft._id.toString(),
      generationId: draft.generationId.toString(),
      signalId: draft.signalId.toString(),
      topic: draft.topic,
      angle: draft.angle as DraftListResult["drafts"][number]["angle"],
      content: draft.content,
      status: draft.status,
      generationUpdatedAt: draft.generationUpdatedAt,
    })),
    total: result?.total[0]?.count ?? 0,
    summary: {
      ...summary,
      total: summary.draft + summary.approved,
    },
  };
}
