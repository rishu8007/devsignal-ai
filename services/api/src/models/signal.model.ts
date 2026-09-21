import { model, Schema, type InferSchemaType, type Types } from "mongoose";
import {
  SIGNAL_CONTENT_TYPES,
  SIGNAL_NOTES_MAX_LENGTH,
  SIGNAL_NOTES_MIN_LENGTH,
  SIGNAL_PRIMARY_AUDIENCES,
  SIGNAL_TOPIC_MAX_LENGTH,
  SIGNAL_TOPIC_MIN_LENGTH,
} from "../constants/signal.constants.js";

const signalSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    topic: {
      type: String,
      required: true,
      trim: true,
      minlength: SIGNAL_TOPIC_MIN_LENGTH,
      maxlength: SIGNAL_TOPIC_MAX_LENGTH,
    },
    notes: {
      type: String,
      required: true,
      trim: true,
      minlength: SIGNAL_NOTES_MIN_LENGTH,
      maxlength: SIGNAL_NOTES_MAX_LENGTH,
    },
    primaryAudience: {
      type: String,
      required: true,
      enum: SIGNAL_PRIMARY_AUDIENCES,
    },
    contentType: {
      type: String,
      required: true,
      enum: SIGNAL_CONTENT_TYPES,
    },
    planning: {
      runId: { type: Schema.Types.ObjectId, ref: "TopicPlanningRun" },
      suggestionId: { type: String, maxlength: 100 },
      sourceVersions: { type: [{ sourceId: String, contentVersion: Number }] },
    },
    revision: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    generationId: {
      type: Schema.Types.ObjectId,
      default: null,
      select: false,
    },
    generationLeaseId: {
      type: String,
      default: null,
      select: false,
    },
    generationLeaseExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    generationLeaseState: {
      type: String,
      enum: ["generating", "persisting"],
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

signalSchema.index({ ownerId: 1, createdAt: -1, _id: -1 });
signalSchema.index(
  { ownerId: 1, "planning.runId": 1, "planning.suggestionId": 1 },
  { unique: true, partialFilterExpression: { "planning.runId": { $exists: true } } },
);

export type SignalDocument = InferSchemaType<typeof signalSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const SignalModel = model("Signal", signalSchema);
