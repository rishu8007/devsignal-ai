import { Router } from "express";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateParams, validateQuery, validateRequest } from "../middleware/validate-request.middleware.js";
import {
  listNotificationRequest,
  markDisplayedNotificationsReadRequest,
  markNotificationReadRequest,
  unreadNotificationCountRequest,
} from "../controllers/notification.controller.js";
import { notificationIdSchema, notificationQuerySchema, notificationReadDisplayedSchema } from "../validation/notification.validation.js";

export const notificationRouter = Router();
notificationRouter.use(authenticationMiddleware);
notificationRouter.get("/", validateQuery(notificationQuerySchema, (locals, value) => { locals.notificationQuery = value; }), listNotificationRequest);
notificationRouter.get("/unread-count", unreadNotificationCountRequest);
notificationRouter.post("/read-displayed", validateRequest(notificationReadDisplayedSchema), markDisplayedNotificationsReadRequest);
notificationRouter.post("/:notificationId/read", validateParams(notificationIdSchema, () => undefined), markNotificationReadRequest);
