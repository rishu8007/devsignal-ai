import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const knowledgeSourceSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 120,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 20_000,
    },
    contentVersion: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    github: {
      repositoryUrl: { type: String, maxlength: 2048 },
      branch: { type: String, maxlength: 255 },
      path: { type: String, maxlength: 1024 },
      commitSha: { type: String, minlength: 40, maxlength: 40 },
      blobSha: { type: String, maxlength: 255 },
      importedContentHash: { type: String, minlength: 64, maxlength: 64 },
    },
    profile: {
      profileId: { type: Schema.Types.ObjectId, ref: "ProfessionalProfile" },
      section: { type: String, enum: ["summary", "resume", "project"] },
      projectId: { type: Schema.Types.ObjectId },
      profileRevision: { type: Number, min: 1 },
      contentHash: { type: String, minlength: 64, maxlength: 64 },
    },
    processingStatus: {
      type: String,
      required: true,
      enum: ["pending", "indexing", "indexed", "failed"],
      default: "pending",
    },
    processingErrorCode: {
      type: String,
      default: null,
      select: false,
      maxlength: 200,
    },
    indexingAttemptId: {
      type: String,
      default: null,
      select: false,
    },
    indexingLeaseExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    indexedContentVersion: {
      type: Number,
      default: null,
      select: false,
    },
    indexedChunkerVersion: {
      type: String,
      default: null,
      select: false,
    },
    indexedEmbeddingModel: {
      type: String,
      default: null,
      select: false,
    },
    indexedDimensions: {
      type: Number,
      default: null,
      select: false,
    },
    indexedChunkCount: {
      type: Number,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "knowledgeSources",
  },
);

knowledgeSourceSchema.index({ ownerId: 1, createdAt: -1, _id: -1 });

export type KnowledgeSourceProcessingStatus =
  | "pending"
  | "indexing"
  | "indexed"
  | "failed";

export type KnowledgeSourceDocument = InferSchemaType<typeof knowledgeSourceSchema> & {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  contentVersion: number;
  github?: {
    repositoryUrl?: string | null;
    branch?: string | null;
    path?: string | null;
    commitSha?: string | null;
    blobSha?: string | null;
    importedContentHash?: string | null;
  } | null;
  profile?: {
    profileId?: Types.ObjectId | string | null;
    section?: "summary" | "resume" | "project" | null;
    projectId?: Types.ObjectId | string | null;
    profileRevision?: number | null;
    contentHash?: string | null;
  } | null;
  processingStatus: KnowledgeSourceProcessingStatus;
  processingErrorCode?: string | null;
  indexingAttemptId?: string | null;
  indexingLeaseExpiresAt?: Date | null;
  indexedContentVersion?: number | null;
  indexedChunkerVersion?: string | null;
  indexedEmbeddingModel?: string | null;
  indexedDimensions?: number | null;
  indexedChunkCount?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export const KnowledgeSourceModel = model("KnowledgeSource", knowledgeSourceSchema);
