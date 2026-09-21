import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const linkedinPublicationSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    signalId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    generationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    variationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    draftContentHash: { type: String, required: true, immutable: true },
    textSnapshot: { type: String, required: true, immutable: true, maxlength: 3000 },
    providerMemberId: { type: String, required: true, immutable: true },
    providerDisplayName: { type: String, default: null, immutable: true },
    connectionGeneration: { type: Number, required: true, immutable: true },
    visibility: { type: String, enum: ["PUBLIC"], required: true, immutable: true },
    operationKey: { type: String, required: true, unique: true, immutable: true },
    previewId: { type: String, required: true, unique: true, immutable: true },
    previewExpiresAt: { type: Date, required: true, immutable: true },
    status: { type: String, enum: ["pending", "dispatching", "published", "rejected", "uncertain"], required: true, default: "pending" },
    providerPostId: { type: String, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null, maxlength: 240 },
    dispatchedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: "linkedinPublications" },
);

linkedinPublicationSchema.index({ ownerId: 1, createdAt: -1 });
linkedinPublicationSchema.index({ ownerId: 1, operationKey: 1 }, { unique: true });

export type LinkedInPublicationDocument = InferSchemaType<typeof linkedinPublicationSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const LinkedInPublicationModel = model("LinkedInPublication", linkedinPublicationSchema);
