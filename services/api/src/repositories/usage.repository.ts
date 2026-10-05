import { Types } from "mongoose";
import { QuotaModel, UsageModel, type UsageDocument } from "../models/usage.model.js";

export function ensureUsageIndexes(): Promise<void> {
  return Promise.all([UsageModel.createIndexes(), QuotaModel.createIndexes()]).then(() => undefined);
}
export async function findUsage(ownerId: string, windowStart: Date, operationKey: string) {
  return UsageModel.findOne({ ownerId, operationKey }).lean().exec();
}
export function findUsageById(id: string) {
  return UsageModel.findById(id).lean().exec();
}
export function reconcileUncertainGeneration(id: string, reconciledBy: string, reason: string, now: Date) {
  return UsageModel.findOneAndUpdate(
    { _id: id, operationType: "generation", status: "uncertain", expiresAt: { $lte: now } },
    { $set: { status: "reconciled", reconciledAt: now, reconciledBy, reconciliationReason: reason } },
    { new: true },
  ).lean().exec();
}
export async function reserveUsage(ownerId: string, windowStart: Date, operationKey: string, operationType: string, limit: number, applicationLimit: number, now = new Date(), reservationTtlMs = 300_000, activeOperationKeyPrefix?: string) {
  await recoverExpiredReservations(windowStart, now);
  if (activeOperationKeyPrefix) {
    const legacyOperationKey = activeOperationKeyPrefix.endsWith(":")
      ? activeOperationKeyPrefix.slice(0, -1)
      : activeOperationKeyPrefix;
    const active = await UsageModel.findOne({
      ownerId,
      $or: [
        { operationKey: new RegExp(`^${escapeRegExp(activeOperationKeyPrefix)}`) },
        { operationKey: legacyOperationKey },
      ],
      $and: [
        {
          $or: [
            { status: { $in: ["dispatched", "uncertain"] } },
            { status: "reserved", expiresAt: { $gt: now } },
          ],
        },
      ],
    }).lean().exec();
    if (active) return { reservation: active, duplicate: true };
  }
  const existing = await findUsage(ownerId, windowStart, operationKey);
  if (existing) {
    if (
      existing.status === "reserved" &&
      existing.dispatchStartedAt == null &&
      existing.expiresAt <= now
    ) {
      const recovered = await UsageModel.findOneAndUpdate(
        {
          _id: existing._id,
          status: "reserved",
          dispatchStartedAt: null,
          expiresAt: { $lte: now },
        },
        { $set: { expiresAt: new Date(now.getTime() + reservationTtlMs) } },
        { new: true },
      ).lean().exec();
      if (recovered) return { reservation: recovered, duplicate: false };
      return { reservation: await findUsage(ownerId, windowStart, operationKey) ?? existing, duplicate: true };
    }
    if (existing.status !== "released") return { reservation: existing, duplicate: true };

    const quota = await reserveQuota(ownerId, existing.windowStart, limit, applicationLimit);
    if (!quota) return null;
    const recovered = await UsageModel.findOneAndUpdate(
      { _id: existing._id, status: "released" },
      {
        $set: {
          status: "reserved",
          expiresAt: new Date(now.getTime() + reservationTtlMs),
          dispatchStartedAt: null,
          completedAt: null,
          inputTokens: null,
          outputTokens: null,
          embeddingTokens: null,
          model: null,
          pricingBasis: null,
          usageRecordedAt: null,
        },
      },
      { new: true },
    ).lean().exec();
    if (recovered) return { reservation: recovered, duplicate: false };
    await releaseQuota(quota);
    return { reservation: await findUsage(ownerId, windowStart, operationKey) ?? existing, duplicate: true };
  }

  const quota = await reserveQuota(ownerId, windowStart, limit, applicationLimit);
  if (!quota) return null;
  try {
    const reservation = await UsageModel.create({ ownerId, windowStart, operationKey, operationType, expiresAt: new Date(now.getTime() + reservationTtlMs) });
    return { reservation: reservation.toObject(), duplicate: false };
  } catch (error) {
    await releaseQuota(quota);
    if (error instanceof Error && /duplicate|E11000/i.test(error.message)) {
      const duplicate = await findUsage(ownerId, windowStart, operationKey);
      if (duplicate) return { reservation: duplicate, duplicate: true };
    }
    throw error;
  }
}
export async function transitionUsage(
  id: string,
  from: UsageDocument["status"],
  to: UsageDocument["status"],
  usage?: Partial<Pick<UsageDocument, "inputTokens" | "outputTokens" | "embeddingTokens" | "model" | "pricingBasis">>,
  now = new Date(),
) {
  const validTransitions: Record<UsageDocument["status"], UsageDocument["status"][]> = {
    reserved: ["dispatched", "released"],
    dispatched: ["completed", "released", "uncertain"],
    completed: [],
    released: [],
    uncertain: [],
    reconciled: [],
  };
  if (!validTransitions[from].includes(to)) return null;
  const updated = await UsageModel.findOneAndUpdate(
    { _id: id, status: from, ...(to === "dispatched" ? { expiresAt: { $gt: now } } : {}) },
    { $set: { status: to, ...usage, ...(to === "dispatched" ? { dispatchStartedAt: now } : {}), ...(to === "completed" ? { completedAt: now, usageRecordedAt: now } : {}) } },
    { new: true },
  ).lean().exec();
  if (updated && (to === "completed" || to === "released" || to === "uncertain")) {
    const consumed = from === "dispatched" && to === "released";
    const delta = to === "released" && !consumed
      ? { $inc: { reserved: -1 } }
      : { $inc: { reserved: -1, completed: 1 } };
    await Promise.all([
      QuotaModel.updateOne({ scope: "owner", ownerId: updated.ownerId, windowStart: updated.windowStart, reserved: { $gt: 0 } }, delta).exec(),
      QuotaModel.updateOne({ scope: "application", ownerId: null, windowStart: updated.windowStart, reserved: { $gt: 0 } }, delta).exec(),
    ]);
  }
  return updated;
}

async function reserveQuota(
  ownerId: string,
  windowStart: Date,
  limit: number,
  applicationLimit: number,
) {
  await QuotaModel.updateOne(
    { scope: "owner", ownerId: new Types.ObjectId(ownerId), windowStart },
    { $setOnInsert: { scope: "owner", ownerId: new Types.ObjectId(ownerId), windowStart, reserved: 0, completed: 0 } },
    { upsert: true },
  ).exec();
  const userWindow = await QuotaModel.findOneAndUpdate(
    { scope: "owner", ownerId: new Types.ObjectId(ownerId), windowStart, $expr: { $lt: [{ $add: ["$reserved", "$completed"] }, limit] } },
    { $inc: { reserved: 1 } }, { new: true },
  ).lean().exec();
  if (!userWindow || userWindow.reserved + userWindow.completed > limit) return null;

  await QuotaModel.updateOne(
    { scope: "application", ownerId: null, windowStart },
    { $setOnInsert: { scope: "application", ownerId: null, windowStart, reserved: 0, completed: 0 } },
    { upsert: true },
  ).exec();
  const appWindow = await QuotaModel.findOneAndUpdate(
    { scope: "application", ownerId: null, windowStart, $expr: { $lt: [{ $add: ["$reserved", "$completed"] }, applicationLimit] } },
    { $inc: { reserved: 1 } }, { new: true },
  ).lean().exec();
  if (!appWindow || appWindow.reserved + appWindow.completed > applicationLimit) {
    await QuotaModel.updateOne({ _id: userWindow._id, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } }).exec();
    return null;
  }
  return { userWindowId: userWindow._id, appWindowId: appWindow._id };
}

async function recoverExpiredReservations(windowStart: Date, now: Date) {
  while (true) {
    const expired = await UsageModel.findOneAndUpdate(
      {
        windowStart,
        status: "reserved",
        dispatchStartedAt: null,
        expiresAt: { $lte: now },
      },
      { $set: { status: "released" } },
      { new: true },
    ).lean().exec();
    if (!expired) return;
    await Promise.all([
      QuotaModel.updateOne(
        { scope: "owner", ownerId: expired.ownerId, windowStart, reserved: { $gt: 0 } },
        { $inc: { reserved: -1 } },
      ).exec(),
      QuotaModel.updateOne(
        { scope: "application", ownerId: null, windowStart, reserved: { $gt: 0 } },
        { $inc: { reserved: -1 } },
      ).exec(),
    ]);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function releaseQuota(quota: { userWindowId: Types.ObjectId; appWindowId: Types.ObjectId }) {
  return Promise.all([
    QuotaModel.updateOne({ _id: quota.userWindowId, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } }).exec(),
    QuotaModel.updateOne({ _id: quota.appWindowId, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } }).exec(),
  ]);
}
export function usageSummary(ownerId: string, windowStart: Date) {
  return Promise.all([
    QuotaModel.findOne({ scope: "owner", ownerId, windowStart }).lean().exec(),
    UsageModel.find({ ownerId, windowStart }).sort({ createdAt: -1 }).lean().exec(),
  ]);
}
