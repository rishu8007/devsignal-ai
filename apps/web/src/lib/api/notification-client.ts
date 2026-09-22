import { request } from "./api-client";

export type NotificationType = "scheduled_reminder" | "published" | "failed" | "blocked" | "missed" | "uncertain";
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  publicationId: string;
  scheduleRevision: number | null;
  createdAt: string;
  readAt: string | null;
  obsoleteAt: string | null;
}

function isNotification(value: unknown): value is AppNotification {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" &&
    "title" in value && typeof value.title === "string" && "message" in value && typeof value.message === "string" &&
    "publicationId" in value && typeof value.publicationId === "string";
}

export function listNotifications(page = 1, limit = 20): Promise<AppNotification[]> {
  return request(`/notifications?page=${page}&limit=${limit}`, { method: "GET" }, (value): value is { success: true; data: { notifications: AppNotification[] } } =>
    typeof value === "object" && value !== null && "success" in value && value.success === true &&
    "data" in value && typeof value.data === "object" && value.data !== null &&
    "notifications" in value.data && Array.isArray(value.data.notifications) && value.data.notifications.every(isNotification),
  ).then((value) => value.data.notifications);
}

export function getUnreadNotificationCount(): Promise<number> {
  return request("/notifications/unread-count", { method: "GET" }, (value): value is { success: true; data: { unreadCount: number } } =>
    typeof value === "object" && value !== null && "success" in value && value.success === true &&
    "data" in value && typeof value.data === "object" && value.data !== null &&
    "unreadCount" in value.data && typeof value.data.unreadCount === "number",
  ).then((value) => value.data.unreadCount);
}

export function markNotificationRead(id: string): Promise<void> {
  return request(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }, (value): value is { success: true } =>
    typeof value === "object" && value !== null && "success" in value && value.success === true,
  ).then(() => undefined);
}

export function markDisplayedNotificationsRead(notificationIds: string[]): Promise<void> {
  return request("/notifications/read-displayed", {
    method: "POST",
    body: JSON.stringify({ notificationIds }),
  }, (value): value is { success: true } =>
    typeof value === "object" && value !== null && "success" in value && value.success === true,
  ).then(() => undefined);
}
