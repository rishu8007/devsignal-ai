import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const engagementSnapshotSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    publicationId: { type: String, required: true, immutable: true },
    impressions: { type: Number, min: 0, default: null },
    reactions: { type: Number, min: 0, default: null },
    comments: { type: Number, min: 0, default: null },
    reposts: { type: Number, min: 0, default: null },
    observedAt: { type: Date, required: true },
    revision: { type: Number, required: true, default: 1 },
  },
  { timestamps: true, versionKey: false, collection: "linkedinEngagementSnapshots" },
);

engagementSnapshotSchema.index({ ownerId: 1, publicationId: 1, observedAt: -1, _id: -1 });
engagementSnapshotSchema.index({ ownerId: 1, createdAt: -1 });

export type EngagementSnapshotDocument = InferSchemaType<typeof engagementSnapshotSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const EngagementSnapshotModel = model("EngagementSnapshot", engagementSnapshotSchema);
