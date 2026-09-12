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
  processingStatus: KnowledgeSourceProcessingStatus;
  processingErrorCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const KnowledgeSourceModel = model("KnowledgeSource", knowledgeSourceSchema);
