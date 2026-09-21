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
  linkedinPublicationPreviewSchema,
} from "../validation/linkedin-publication.validation.js";

export const linkedinPublicationRouter = Router();

linkedinPublicationRouter.use(authenticationMiddleware);
linkedinPublicationRouter.use(linkedinPublishingRateLimitMiddleware);
linkedinPublicationRouter.get("/", getLinkedInPublicationHistory);
linkedinPublicationRouter.post(
  "/preview",
  validateRequest(linkedinPublicationPreviewSchema),
  previewLinkedInPublication,
);
linkedinPublicationRouter.post(
  "/confirm",
  validateRequest(linkedinPublicationConfirmSchema),
  confirmLinkedInPublicationRequest,
);
