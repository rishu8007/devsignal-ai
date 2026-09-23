import { Types } from "mongoose";
import { QuotaModel, UsageModel, type UsageDocument } from "../models/usage.model.js";

export function ensureUsageIndexes(): Promise<void> {
  return Promise.all([UsageModel.createIndexes(), QuotaModel.createIndexes()]).then(() => undefined);
}
export async function findUsage(ownerId: string, windowStart: Date, operationKey: string) {
  return UsageModel.findOne({ ownerId, operationKey }).lean().exec();
}
export async function reserveUsage(ownerId: string, windowStart: Date, operationKey: string, operationType: string, limit: number, applicationLimit: number, now = new Date(), reservationTtlMs = 300_000) {
  const existing = await findUsage(ownerId, windowStart, operationKey);
  if (existing) return { reservation: existing, duplicate: true };
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
  try {
    const reservation = await UsageModel.create({ ownerId, windowStart, operationKey, operationType, expiresAt: new Date(now.getTime() + reservationTtlMs) });
    return { reservation: reservation.toObject(), duplicate: false };
  } catch (error) {
    await QuotaModel.updateOne({ _id: userWindow._id, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } }).exec();
    await QuotaModel.updateOne({ _id: appWindow._id, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } }).exec();
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
    dispatched: ["completed", "uncertain"],
    completed: [],
    released: [],
    uncertain: [],
  };
  if (!validTransitions[from].includes(to)) return null;
  const updated = await UsageModel.findOneAndUpdate(
    { _id: id, status: from, ...(to === "dispatched" ? { expiresAt: { $gt: now } } : {}) },
    { $set: { status: to, ...usage, ...(to === "dispatched" ? { dispatchStartedAt: now } : {}), ...(to === "completed" ? { completedAt: now, usageRecordedAt: now } : {}) } },
    { new: true },
  ).lean().exec();
  if (updated && (to === "completed" || to === "released" || to === "uncertain")) {
    const delta = to === "released"
      ? { $inc: { reserved: -1 } }
      : { $inc: { reserved: -1, completed: 1 } };
    await Promise.all([
      QuotaModel.updateOne({ scope: "owner", ownerId: updated.ownerId, windowStart: updated.windowStart, reserved: { $gt: 0 } }, delta).exec(),
      QuotaModel.updateOne({ scope: "application", ownerId: null, windowStart: updated.windowStart, reserved: { $gt: 0 } }, delta).exec(),
    ]);
  }
  return updated;
}
export function usageSummary(ownerId: string, windowStart: Date) {
  return Promise.all([
    QuotaModel.findOne({ scope: "owner", ownerId, windowStart }).lean().exec(),
    UsageModel.find({ ownerId, windowStart }).sort({ createdAt: -1 }).lean().exec(),
  ]);
}
