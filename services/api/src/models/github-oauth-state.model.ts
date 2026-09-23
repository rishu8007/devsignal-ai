import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const githubOauthStateSchema = new Schema({
  stateHash: { type: String, unique: true, required: true, immutable: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  sessionHash: { type: String, required: true, immutable: true },
  expiresAt: { type: Date, required: true, immutable: true },
  connectionGeneration: { type: Number, required: true, immutable: true },
  usedAt: { type: Date, default: null },
  pendingInstallationId: { type: Number, default: null },
}, { timestamps: true, versionKey: false, collection: "githubOauthStates" });
githubOauthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type GithubOauthStateDocument = InferSchemaType<typeof githubOauthStateSchema> & { _id: Types.ObjectId };
export const GithubOauthStateModel = model("GithubOauthState", githubOauthStateSchema);
