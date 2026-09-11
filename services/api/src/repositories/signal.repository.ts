import { SignalModel, type SignalDocument } from "../models/signal.model.js";
import type { CreateSignalInput, ListSignalsQuery } from "../validation/signal.validation.js";

export async function createSignal(
  ownerId: string,
  input: CreateSignalInput,
): Promise<SignalDocument> {
  return SignalModel.create({ ownerId, ...input });
}

export async function findSignalsByOwner(
  ownerId: string,
  query: ListSignalsQuery,
): Promise<SignalDocument[]> {
  const skip = (query.page - 1) * query.limit;
  return SignalModel.find({ ownerId })
    .select("_id topic notes primaryAudience contentType createdAt updatedAt")
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(query.limit)
    .lean<SignalDocument[]>()
    .exec();
}

export function countSignalsByOwner(ownerId: string): Promise<number> {
  return SignalModel.countDocuments({ ownerId }).exec();
}

export function findSignalByIdAndOwner(
  ownerId: string,
  signalId: string,
): Promise<SignalDocument | null> {
  return SignalModel.findOne({ _id: signalId, ownerId })
    .select("_id topic notes primaryAudience contentType")
    .lean<SignalDocument>()
    .exec();
}
