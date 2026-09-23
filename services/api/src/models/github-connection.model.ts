import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const githubConnectionSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, required: true, unique: true, immutable: true },
  githubUserId: { type: String, required: true },
  login: { type: String, required: true, maxlength: 100 },
  installationId: { type: Number, required: true },
  accessTokenEncrypted: { type: String, required: true },
  accessTokenExpiresAt: { type: Date, required: true },
  status: { type: String, enum: ["connected", "revoked"], required: true, default: "connected" },
  connectionGeneration: { type: Number, required: true, default: 0 },
  repositories: [{ id: { type: Number, required: true }, fullName: { type: String, required: true }, private: { type: Boolean, required: true }, defaultBranch: { type: String, required: true }, selected: { type: Boolean, required: true, default: true } }],
  sync: {
    status: { type: String, enum: ["idle", "syncing", "error"], required: true, default: "idle" },
    startedAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 500 },
    cursor: { type: String, default: null },
    nextEligibleAt: { type: Date, default: null },
    rateLimitResetAt: { type: Date, default: null },
    progress: [{
      repositoryId: { type: Number, required: true },
      kind: { type: String, enum: ["commit", "pull_request", "release"], required: true },
      cursor: { type: String, default: null },
      page: { type: Number, required: true, default: 1 },
      complete: { type: Boolean, required: true, default: false },
      lastOccurredAt: { type: Date, default: null },
    }],
  },
}, { timestamps: true, versionKey: false, collection: "githubConnections" });

export type GithubConnectionDocument = InferSchemaType<typeof githubConnectionSchema> & { _id: Types.ObjectId };
export const GithubConnectionModel = model("GithubConnection", githubConnectionSchema);
