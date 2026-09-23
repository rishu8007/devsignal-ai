import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const githubActivitySchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  connectionGeneration: { type: Number, required: true, immutable: true },
  repositoryId: { type: Number, required: true, immutable: true },
  repositoryFullName: { type: String, required: true },
  kind: { type: String, enum: ["commit", "pull_request", "release"], required: true, immutable: true },
  providerId: { type: String, required: true, immutable: true },
  title: { type: String, required: true, maxlength: 500 },
  summary: { type: String, required: true, maxlength: 5000 },
  url: { type: String, required: true },
  occurredAt: { type: Date, required: true },
  authorLogin: { type: String, default: null },
  isPersonal: { type: Boolean, required: true, default: false },
  importedAt: { type: Date, required: true },
  convertedSignalId: { type: Schema.Types.ObjectId, default: null },
  conversionClaim: { type: String, default: null },
  conversionClaimedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false, collection: "githubActivities" });
githubActivitySchema.index({ ownerId: 1, repositoryId: 1, kind: 1, providerId: 1 }, { unique: true });
githubActivitySchema.index({ ownerId: 1, occurredAt: -1 });
export type GithubActivityDocument = InferSchemaType<typeof githubActivitySchema> & { _id: Types.ObjectId };
export const GithubActivityModel = model("GithubActivity", githubActivitySchema);
