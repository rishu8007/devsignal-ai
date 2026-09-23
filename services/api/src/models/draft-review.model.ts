import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const findingSchema = new Schema(
  {
    category: { type: String, enum: ["unsupported_personal_claim", "unsupported_technical_claim", "contradiction", "overstatement", "clarity"], required: true },
    severity: { type: String, enum: ["low", "medium", "high"], required: true },
    passage: { type: String, required: true, maxlength: 1000 },
    explanation: { type: String, required: true, maxlength: 1200 },
    evidenceIds: { type: [String], required: true, default: [] },
    suggestion: { type: String, required: true, maxlength: 1000 },
  },
  { _id: false, versionKey: false },
);

const draftReviewSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    requestId: { type: String, required: true, maxlength: 100 },
    inputFingerprint: { type: String, required: true, immutable: true },
    signalId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    generationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    variationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    researchBriefId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    draftContentHash: { type: String, required: true, immutable: true },
    draftContent: { type: String, required: true, maxlength: 3000, immutable: true },
    briefSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
    findings: { type: [findingSchema], required: true, default: [] },
    summary: { type: String, required: true, maxlength: 1500 },
    qualityScore: { type: Number, default: null, min: 0, max: 100 },
    proposedDraft: { type: String, default: null, maxlength: 3000 },
    status: { type: String, enum: ["running", "succeeded", "failed", "uncertain"], required: true },
    stale: { type: Boolean, required: true, default: false },
    errorCode: { type: String, default: null, maxlength: 80 },
    model: { type: String, required: true, maxlength: 200 },
  },
  { timestamps: true, versionKey: false, collection: "draftReviews" },
);

draftReviewSchema.index({ ownerId: 1, requestId: 1 }, { unique: true });
draftReviewSchema.index({ ownerId: 1, signalId: 1, createdAt: -1 });

export type DraftReviewDocument = InferSchemaType<typeof draftReviewSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const DraftReviewModel = model("DraftReview", draftReviewSchema);
