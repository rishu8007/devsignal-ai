import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const evidenceSchema = new Schema({
  evidenceId: { type: String, required: true, maxlength: 120 },
  sourceId: { type: Schema.Types.ObjectId, required: true },
  contentVersion: { type: Number, required: true, min: 1 },
  chunkId: { type: String, required: true, maxlength: 200 },
  chunkIndex: { type: Number, required: true, min: 0 },
  text: { type: String, required: true, maxlength: 1000 },
  score: { type: Number, required: true },
  quote: { type: String, required: true, maxlength: 1000 },
});
const briefSchema = new Schema({
  topicSummary: { type: String, required: true, maxlength: 1200 },
  talkingPoints: { type: [{ text: String, evidenceIds: [String] }], required: true },
  claimAssessments: { type: [{ claim: String, assessment: String, explanation: String, evidenceIds: [String] }], required: true },
  missingInformation: { type: [String], required: true },
  questions: { type: [String], required: true },
  limitations: { type: [String], required: true },
});
const researchBriefSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    requestId: { type: String, required: true, maxlength: 100 },
    inputFingerprint: { type: String, required: true, immutable: true },
    signalId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    signalRevision: { type: Number, required: true },
    sourceVersions: { type: [{ sourceId: String, contentVersion: Number }], required: true },
    evidence: { type: [evidenceSchema], required: true },
    brief: { type: briefSchema, required: true },
    status: { type: String, enum: ["running", "succeeded", "no_evidence", "failed", "uncertain"], required: true },
    stale: { type: Boolean, default: false },
    errorCode: { type: String, default: null, maxlength: 80 },
    model: { type: String, required: true, maxlength: 200 },
  },
  { timestamps: true, versionKey: false, collection: "researchBriefs" },
);
researchBriefSchema.index({ ownerId: 1, requestId: 1 }, { unique: true });
researchBriefSchema.index({ ownerId: 1, signalId: 1, createdAt: -1 });

export type ResearchBriefDocument = InferSchemaType<typeof researchBriefSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export const ResearchBriefModel = model("ResearchBrief", researchBriefSchema);
