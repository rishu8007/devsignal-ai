import {
  GenerationModel,
  type GenerationDocument,
} from "../models/generation.model.js";
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
