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
