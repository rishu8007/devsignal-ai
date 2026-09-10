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
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

signalSchema.index({ ownerId: 1, createdAt: -1, _id: -1 });

export type SignalDocument = InferSchemaType<typeof signalSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const SignalModel = model("Signal", signalSchema);
