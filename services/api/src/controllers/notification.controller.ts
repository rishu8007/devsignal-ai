import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import {
  getNotifications,
  getUnreadNotificationCount,
  readDisplayedNotifications,
  readNotification,
} from "../services/notification.service.js";

function ownerId(request: Request): string {
  const value = request.auth?.userId;
  if (!value) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
  return value;
}

export async function listNotificationRequest(request: Request, response: Response): Promise<void> {
  const page = Number(response.locals.notificationQuery.page);
  const limit = Number(response.locals.notificationQuery.limit);
  const notifications = await getNotifications(ownerId(request), page, limit);
  response.json({ success: true, data: { notifications, page, limit } });
}

export async function unreadNotificationCountRequest(request: Request, response: Response): Promise<void> {
  response.json({ success: true, data: { unreadCount: await getUnreadNotificationCount(ownerId(request)) } });
}

export async function markNotificationReadRequest(request: Request, response: Response): Promise<void> {
  const notification = await readNotification(ownerId(request), String(request.params.notificationId));
  response.json({ success: true, data: { notification } });
}

export async function markDisplayedNotificationsReadRequest(request: Request, response: Response): Promise<void> {
  await readDisplayedNotifications(ownerId(request), request.body.notificationIds);
  response.json({ success: true });
}
