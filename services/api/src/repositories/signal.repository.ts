import { SignalModel, type SignalDocument } from "../models/signal.model.js";
import type {
  CreateSignalInput,
  ListSignalsQuery,
  UpdateSignalInput,
} from "../validation/signal.validation.js";

export async function createSignal(
  ownerId: string,
  input: CreateSignalInput,
): Promise<SignalDocument> {
  return SignalModel.create({ ownerId, ...input, revision: 1 });
}

export async function findSignalsByOwner(
  ownerId: string,
  query: ListSignalsQuery,
): Promise<SignalDocument[]> {
  const skip = (query.page - 1) * query.limit;
  return SignalModel.find({ ownerId })
    .select("_id topic notes primaryAudience contentType revision createdAt updatedAt")
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
    .select(
      "_id topic notes primaryAudience contentType revision " +
        "+generationId +generationLeaseId +generationLeaseExpiresAt +generationLeaseState",
    )
    .lean<SignalDocument>()
    .exec();
}

export function updateSignalIfEditable(
  ownerId: string,
  signalId: string,
  input: UpdateSignalInput,
  now: Date,
): Promise<SignalDocument | null> {
  return SignalModel.findOneAndUpdate(
    {
      _id: signalId,
      ownerId,
      revision: input.expectedRevision,
      generationId: null,
      $or: [
        { generationLeaseId: null },
        {
          generationLeaseState: "generating",
          generationLeaseExpiresAt: { $lte: now },
        },
      ],
    },
    {
      $set: {
        topic: input.topic,
        notes: input.notes,
        primaryAudience: input.primaryAudience,
        contentType: input.contentType,
      },
      $inc: { revision: 1 },
    },
    { new: true, runValidators: true },
  )
    .select("_id topic notes primaryAudience contentType revision createdAt updatedAt")
    .lean<SignalDocument>()
    .exec();
}

export function reserveSignalForGeneration(
  ownerId: string,
  signalId: string,
  leaseId: string,
  leaseExpiresAt: Date,
): Promise<SignalDocument | null> {
  return SignalModel.findOneAndUpdate(
    {
      _id: signalId,
      ownerId,
      generationId: null,
      $or: [
        { generationLeaseId: null },
        {
          generationLeaseState: { $in: ["generating", null] },
          generationLeaseExpiresAt: { $lte: new Date() },
        },
      ],
    },
    {
      $set: {
        generationLeaseId: leaseId,
        generationLeaseExpiresAt: leaseExpiresAt,
        generationLeaseState: "generating",
      },
    },
    { new: true },
  )
    .select(
      "_id topic notes primaryAudience contentType revision " +
        "+generationId +generationLeaseId +generationLeaseExpiresAt +generationLeaseState",
    )
    .lean<SignalDocument>()
    .exec();
}

export function markSignalGeneration(
  ownerId: string,
  signalId: string,
  leaseId: string,
  generationId: string,
): Promise<SignalDocument | null> {
  return SignalModel.findOneAndUpdate(
    {
      _id: signalId,
      ownerId,
      generationLeaseId: leaseId,
      generationLeaseState: "persisting",
    },
    {
      $set: { generationId },
      $unset: { generationLeaseId: 1, generationLeaseExpiresAt: 1, generationLeaseState: 1 },
    },
    { new: true },
  )
    .select("_id")
    .lean<SignalDocument>()
    .exec();
}

export function beginSignalGenerationPersistence(
  ownerId: string,
  signalId: string,
  revision: number,
  leaseId: string,
  now: Date,
): Promise<SignalDocument | null> {
  return SignalModel.findOneAndUpdate(
    {
      _id: signalId,
      ownerId,
      revision,
      generationId: null,
      generationLeaseId: leaseId,
      generationLeaseState: "generating",
      generationLeaseExpiresAt: { $gt: now },
    },
    {
      $set: { generationLeaseState: "persisting" },
      $unset: { generationLeaseExpiresAt: 1 },
    },
    { new: true },
  )
    .select("_id revision +generationLeaseId +generationLeaseState")
    .lean<SignalDocument>()
    .exec();
}

export function reconcileSignalGeneration(
  ownerId: string,
  signalId: string,
  generationId: string,
): Promise<SignalDocument | null> {
  return SignalModel.findOneAndUpdate(
    {
      _id: signalId,
      ownerId,
      generationId: null,
      generationLeaseState: "persisting",
    },
    {
      $set: { generationId },
      $unset: { generationLeaseId: 1, generationLeaseExpiresAt: 1, generationLeaseState: 1 },
    },
    { new: true },
  )
    .select("_id")
    .lean<SignalDocument>()
    .exec();
}

export function hasActiveSignalGenerationLease(
  ownerId: string,
  signalId: string,
  leaseId: string,
  now: Date,
): Promise<boolean> {
  return SignalModel.exists({
    _id: signalId,
    ownerId,
    generationLeaseId: leaseId,
    generationLeaseState: "generating",
    generationLeaseExpiresAt: { $gt: now },
  }).then(Boolean);
}

export function releaseSignalGenerationLease(
  ownerId: string,
  signalId: string,
  leaseId: string,
): Promise<SignalDocument | null> {
  return SignalModel.findOneAndUpdate(
    {
      _id: signalId,
      ownerId,
      generationLeaseId: leaseId,
      generationLeaseState: "generating",
    },
    { $unset: { generationLeaseId: 1, generationLeaseExpiresAt: 1, generationLeaseState: 1 } },
    { new: true },
  )
    .select("_id")
    .lean<SignalDocument>()
    .exec();
}
