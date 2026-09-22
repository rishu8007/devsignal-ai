import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const notificationSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    eventKey: { type: String, required: true, immutable: true },
    type: {
      type: String,
      enum: ["scheduled_reminder", "published", "failed", "blocked", "missed", "uncertain"],
      required: true,
      immutable: true,
    },
    title: { type: String, required: true, immutable: true, maxlength: 120 },
    message: { type: String, required: true, immutable: true, maxlength: 300 },
    publicationId: { type: String, required: true, immutable: true },
    scheduleRevision: { type: Number, default: null, immutable: true },
    createdAt: { type: Date, required: true, immutable: true },
    readAt: { type: Date, default: null },
    obsoleteAt: { type: Date, default: null },
  },
  { versionKey: false, collection: "notifications" },
);

notificationSchema.index({ ownerId: 1, eventKey: 1 }, { unique: true });
notificationSchema.index({ ownerId: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ ownerId: 1, readAt: 1 });

export type NotificationDocument = InferSchemaType<typeof notificationSchema> & {
  _id: Types.ObjectId;
};

export const NotificationModel = model("Notification", notificationSchema);
