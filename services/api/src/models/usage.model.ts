import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const usageSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  windowStart: { type: Date, required: true, immutable: true },
  operationKey: { type: String, required: true, immutable: true },
  operationType: { type: String, required: true, immutable: true },
  status: { type: String, required: true, enum: ["reserved", "dispatched", "completed", "released", "uncertain"], default: "reserved" },
  expiresAt: { type: Date, required: true },
  dispatchStartedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  inputTokens: { type: Number, min: 0, default: null },
  outputTokens: { type: Number, min: 0, default: null },
  embeddingTokens: { type: Number, min: 0, default: null },
  model: { type: String, default: null },
  pricingBasis: { type: Schema.Types.Mixed, default: null },
  usageRecordedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
usageSchema.index({ ownerId: 1, windowStart: 1, operationKey: 1 }, { unique: true });
usageSchema.index({ ownerId: 1, operationKey: 1 }, { unique: true });
usageSchema.index({ ownerId: 1, windowStart: 1, createdAt: 1 });
export type UsageDocument = InferSchemaType<typeof usageSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const UsageModel = model("AiUsageReservation", usageSchema);

const quotaSchema = new Schema({
  scope: { type: String, required: true, immutable: true },
  ownerId: { type: Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  windowStart: { type: Date, required: true, immutable: true },
  reserved: { type: Number, required: true, min: 0, default: 0 },
  completed: { type: Number, required: true, min: 0, default: 0 },
}, { versionKey: false });
quotaSchema.index({ scope: 1, ownerId: 1, windowStart: 1 }, { unique: true });
export type QuotaDocument = InferSchemaType<typeof quotaSchema> & { _id: Types.ObjectId };
export const QuotaModel = model("AiQuotaWindow", quotaSchema);
