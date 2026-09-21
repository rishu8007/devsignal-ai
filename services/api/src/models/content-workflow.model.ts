import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const workflowSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    requestId: { type: String, required: true, maxlength: 100 },
    inputFingerprint: { type: String, required: true, immutable: true },
    signalId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    signalRevision: { type: Number, required: true, immutable: true },
    sourceVersions: { type: [{ sourceId: String, contentVersion: Number }], required: true, immutable: true },
    inputSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
    threadId: { type: String, required: true, immutable: true, maxlength: 100 },
    status: { type: String, enum: ["queued", "running", "awaiting_research", "awaiting_approval", "stale", "failed", "uncertain", "cancelled", "completed"], required: true },
    phase: { type: String, enum: ["research", "write", "review", "approval", "completed", "cancelled"], required: true },
    researchBriefId: { type: Schema.Types.ObjectId, default: null },
    generationId: { type: Schema.Types.ObjectId, default: null },
    reviewIds: { type: [Schema.Types.ObjectId], default: [] },
    reviewBindings: { type: [Schema.Types.Mixed], default: [] },
    researchOutput: { type: Schema.Types.Mixed, default: null },
    generationOutput: { type: Schema.Types.Mixed, default: null },
    reviewOutput: { type: Schema.Types.Mixed, default: null },
    approvedVariationId: { type: Schema.Types.ObjectId, default: null },
    approvedDraftHash: { type: String, default: null },
    leaseId: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null },
    cancellationRequested: { type: Boolean, default: false },
    errorCode: { type: String, default: null, maxlength: 80 },
  },
  { timestamps: true, versionKey: false, collection: "contentWorkflows" },
);
workflowSchema.index({ ownerId: 1, requestId: 1 }, { unique: true });
workflowSchema.index({ ownerId: 1, signalId: 1, createdAt: -1 });
workflowSchema.index({ status: 1, leaseExpiresAt: 1 });

export type ContentWorkflowDocument = InferSchemaType<typeof workflowSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export const ContentWorkflowModel = model("ContentWorkflow", workflowSchema);
