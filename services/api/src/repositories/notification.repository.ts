import { NotificationModel, type NotificationDocument } from "../models/notification.model.js";

export function ensureNotificationIndexes(): Promise<void> {
  return NotificationModel.createIndexes().then(() => undefined);
}

export function createNotification(input: Record<string, unknown>) {
  return NotificationModel.create(input);
}

export function listNotifications(ownerId: string, skip: number, limit: number) {
  return NotificationModel.find({ ownerId, obsoleteAt: null })
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .lean<NotificationDocument[]>()
    .exec();
}

export function countUnreadNotifications(ownerId: string) {
  return NotificationModel.countDocuments({ ownerId, readAt: null, obsoleteAt: null }).exec();
}

export function markNotificationRead(ownerId: string, id: string, readAt: Date) {
  return NotificationModel.findOneAndUpdate(
    { _id: id, ownerId, readAt: null, obsoleteAt: null },
    { $set: { readAt } },
    { new: true },
  ).lean<NotificationDocument>().exec();
}

export function markNotificationsRead(ownerId: string, ids: string[], readAt: Date) {
  return NotificationModel.updateMany(
    { ownerId, _id: { $in: ids }, readAt: null, obsoleteAt: null },
    { $set: { readAt } },
  ).exec();
}

export function obsoleteScheduledReminders(publicationId: string, scheduleRevision: number | null, at: Date) {
  return NotificationModel.updateMany(
    {
      publicationId,
      type: "scheduled_reminder",
      obsoleteAt: null,
      ...(scheduleRevision === null ? {} : { scheduleRevision: { $ne: scheduleRevision } }),
    },
    { $set: { obsoleteAt: at } },
  ).exec();
}
