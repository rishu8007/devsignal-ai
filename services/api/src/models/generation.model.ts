import { model, Schema, type InferSchemaType, type Types } from "mongoose";
import { GENERATION_ANGLES } from "../types/generation.js";

const generationVariationSchema = new Schema(
  {
    angle: {
      type: String,
      required: true,
      enum: GENERATION_ANGLES,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 100,
      maxlength: 3000,
    },
    status: {
      type: String,
      required: true,
      enum: ["draft", "approved"],
      default: "draft",
    },
  },
  { _id: true, versionKey: false },
);

const generationSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    signalId: {
      type: Schema.Types.ObjectId,
      ref: "Signal",
      required: true,
      immutable: true,
    },
    source: {
      topic: { type: String, required: true, immutable: true },
      notes: { type: String, required: true, immutable: true },
      primaryAudience: { type: String, required: true, immutable: true },
      contentType: { type: String, required: true, immutable: true },
    },
    model: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },
    variations: {
      type: [generationVariationSchema],
      required: true,
      validate: {
        validator: (value: Array<{ angle?: string }>) =>
          value.length === 3 &&
          value.map((variation) => variation.angle).join(",") === GENERATION_ANGLES.join(","),
        message: "A generation must contain the three required variations in order",
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

generationSchema.index({ ownerId: 1, signalId: 1 }, { unique: true });

export type GenerationDocument = InferSchemaType<typeof generationSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const GenerationModel = model("Generation", generationSchema);
