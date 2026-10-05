import { Router } from "express";
import {
  confirmLinkedInPublicationRequest,
  getLinkedInPublicationHistory,
  previewLinkedInPublication,
} from "../controllers/linkedin-publication.controller.js";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateRequest } from "../middleware/validate-request.middleware.js";
import { linkedinPublishingRateLimitMiddleware } from "../middleware/linkedin-publishing-rate-limit.middleware.js";
import {
  linkedinPublicationConfirmSchema,
  linkedinPublicationScheduleSchema,
  linkedinPublicationRescheduleSchema,
  linkedinPublicationCancelSchema,
  linkedinPublicationPreviewSchema,
} from "../validation/linkedin-publication.validation.js";
import {
  cancelLinkedInPublicationRequest,
  rescheduleLinkedInPublicationRequest,
  scheduleLinkedInPublicationRequest,
} from "../controllers/linkedin-publication.controller.js";

export const linkedinPublicationRouter = Router();

linkedinPublicationRouter.use(authenticationMiddleware);
linkedinPublicationRouter.get("/", getLinkedInPublicationHistory);
linkedinPublicationRouter.post(
  "/preview",
  linkedinPublishingRateLimitMiddleware,
  validateRequest(linkedinPublicationPreviewSchema),
  previewLinkedInPublication,
);
linkedinPublicationRouter.post("/schedule", linkedinPublishingRateLimitMiddleware, validateRequest(linkedinPublicationScheduleSchema), scheduleLinkedInPublicationRequest);
linkedinPublicationRouter.post("/reschedule", linkedinPublishingRateLimitMiddleware, validateRequest(linkedinPublicationRescheduleSchema), rescheduleLinkedInPublicationRequest);
linkedinPublicationRouter.post("/cancel", linkedinPublishingRateLimitMiddleware, validateRequest(linkedinPublicationCancelSchema), cancelLinkedInPublicationRequest);
linkedinPublicationRouter.post(
  "/confirm",
  linkedinPublishingRateLimitMiddleware,
  validateRequest(linkedinPublicationConfirmSchema),
  confirmLinkedInPublicationRequest,
);
