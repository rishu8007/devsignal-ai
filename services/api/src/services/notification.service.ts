import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import {
  createNotification,
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markNotificationsRead,
  obsoleteScheduledReminders,
} from "../repositories/notification.repository.js";
import { listLinkedInPublicationsPage } from "../repositories/linkedin.repository.js";

const reminderLeadMs = 15 * 60_000;

const defaultRepository: NotificationRepository = {
  create: createNotification,
  list: listNotifications,
  countUnread: countUnreadNotifications,
  markRead: markNotificationRead,
  markReadMany: markNotificationsRead,
  obsoleteReminders: obsoleteScheduledReminders,
  listPublications: listLinkedInPublicationsPage,
};

function publicNotification(value: Awaited<ReturnType<typeof listNotifications>>[number]) {
  return {
    id: value._id.toString(),
    type: value.type,
    title: value.title,
    message: value.message,
    publicationId: value.publicationId,
    scheduleRevision: value.scheduleRevision,
    createdAt: value.createdAt,
    readAt: value.readAt,
    obsoleteAt: value.obsoleteAt,
  };
}

function timeText(date: Date, timezone: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone ?? "UTC",
  }).format(date) + ` (${timezone ?? "UTC"})`;
}

async function insertOnce(repository: NotificationRepository, ownerId: string, input: Record<string, unknown>) {
  try {
    await repository.create({ ownerId, ...input });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === 11000) return;
    throw error;
  }
}

export type NotificationRepository = {
  create: typeof createNotification;
  list: typeof listNotifications;
  countUnread: typeof countUnreadNotifications;
  markRead: typeof markNotificationRead;
  markReadMany: typeof markNotificationsRead;
  obsoleteReminders: typeof obsoleteScheduledReminders;
  listPublications: typeof listLinkedInPublicationsPage;
};

export async function reconcileLinkedInNotifications(
  now = new Date(),
  repository: NotificationRepository = defaultRepository,
  afterId: string | null = null,
) {
  const publications = await repository.listPublications(afterId, 100);
  for (const publication of publications) {
    try {
      const ownerId = publication.ownerId.toString();
      const publicationId = publication.previewId;
      await repository.obsoleteReminders(
        publicationId,
        publication.status === "scheduled" ? publication.scheduleRevision : null,
        now,
      );
      if (publication.status === "scheduled" && publication.scheduledAt &&
        publication.scheduledAt.getTime() > now.getTime() &&
        publication.scheduledAt.getTime() - now.getTime() <= reminderLeadMs) {
        await insertOnce(repository, ownerId, {
          eventKey: `publication:${publicationId}:scheduled:${publication.scheduleRevision}`,
          type: "scheduled_reminder",
          title: "LinkedIn publication is coming up",
          message: `Your publication is scheduled for ${timeText(publication.scheduledAt, publication.scheduledTimezone ?? null)}.`,
          publicationId,
          scheduleRevision: publication.scheduleRevision,
          createdAt: now,
        });
      }
      const outcome: Record<string, { type: "published" | "failed" | "blocked" | "missed" | "uncertain"; title: string; message: string }> = {
      published: { type: "published", title: "LinkedIn publication confirmed", message: "Your publication was confirmed on LinkedIn." },
      rejected: { type: "failed", title: "LinkedIn publication failed", message: "LinkedIn rejected this publication. Review it and create a new explicit action." },
      blocked: { type: "blocked", title: "LinkedIn publication needs attention", message: "This publication is blocked and needs your attention before it can proceed." },
      missed: { type: "missed", title: "LinkedIn publishing window missed", message: "This publication missed its publishing window and was not sent." },
      uncertain: { type: "uncertain", title: "Check LinkedIn publication", message: "LinkedIn publication outcome is uncertain. Check LinkedIn before taking further action." },
      };
      const item = outcome[publication.status];
      if (item) {
        await insertOnce(repository, ownerId, {
          eventKey: `publication:${publicationId}:outcome:${publication.status}`,
          type: item.type,
          title: item.title,
          message: item.message,
          publicationId,
          scheduleRevision: publication.scheduleRevision,
          createdAt: publication.publishedAt ?? publication.updatedAt ?? now,
        });
      }
    } catch {
      // Continue the page so one failed write cannot starve later publications.
    }
  }
  return publications.length === 100 ? publications.at(-1)?._id.toString() ?? null : null;
}

export async function getNotifications(ownerId: string, page: number, limit: number, repository = defaultRepository) {
  const values = await repository.list(ownerId, (page - 1) * limit, limit);
  return values.map(publicNotification);
}

export function getUnreadNotificationCount(ownerId: string, repository = defaultRepository) {
  return repository.countUnread(ownerId);
}

export async function readNotification(ownerId: string, id: string, repository = defaultRepository) {
  if (!Types.ObjectId.isValid(id)) throw new AppError(400, "VALIDATION_ERROR", "Invalid notification id.");
  const value = await repository.markRead(ownerId, id, new Date());
  if (!value) return null;
  return publicNotification(value);
}

export function readDisplayedNotifications(ownerId: string, ids: string[], repository = defaultRepository, now = new Date()) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0 || uniqueIds.length > 50 || uniqueIds.some((id) => !Types.ObjectId.isValid(id))) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid notification ids.");
  }
  return repository.markReadMany(ownerId, uniqueIds, now);
}

export function startNotificationReconciliationWorker(
  intervalMs = 60_000,
  clock: () => Date = () => new Date(),
  repository: NotificationRepository = defaultRepository,
) {
  let stopped = false;
  let active: Promise<void> | null = null;
  let cursor: string | null = null;
  const run = () => {
    if (stopped || active) return;
    active = reconcileLinkedInNotifications(clock(), repository, cursor)
      .then((nextCursor) => { cursor = nextCursor; })
      .catch(() => undefined)
      .finally(() => { active = null; });
  };
  const timer = setInterval(run, intervalMs);
  run();
  return async () => {
    stopped = true;
    clearInterval(timer);
    if (active) await active;
  };
}
