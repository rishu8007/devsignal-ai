import { Router } from "express";
import {
  linkedinCallback,
  linkedinConnect,
  linkedinDisconnect,
  linkedinPostingConsent,
  linkedinStatus,
} from "../controllers/linkedin.controller.js";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateRequest } from "../middleware/validate-request.middleware.js";
import { linkedinConnectSchema } from "../validation/linkedin.validation.js";

export const linkedinRouter = Router();

linkedinRouter.get("/linkedin/callback", linkedinCallback);
linkedinRouter.get("/linkedin/status", authenticationMiddleware, linkedinStatus);
linkedinRouter.post("/linkedin/connect", authenticationMiddleware, validateRequest(linkedinConnectSchema), linkedinConnect);
linkedinRouter.post("/linkedin/reconnect", authenticationMiddleware, validateRequest(linkedinConnectSchema), linkedinConnect);
linkedinRouter.post("/linkedin/posting-consent", authenticationMiddleware, validateRequest(linkedinConnectSchema), linkedinPostingConsent);
linkedinRouter.delete("/linkedin", authenticationMiddleware, linkedinDisconnect);
