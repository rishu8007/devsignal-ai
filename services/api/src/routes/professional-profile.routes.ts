import { Router } from "express";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateRequest } from "../middleware/validate-request.middleware.js";
import { getProfile, previewProfileExport, saveProfile, saveProfileExport } from "../controllers/professional-profile.controller.js";
import { professionalProfileInputSchema, profileKnowledgePreviewSchema, profileKnowledgeSaveSchema } from "../validation/professional-profile.validation.js";

export const professionalProfileRouter = Router();
professionalProfileRouter.use(authenticationMiddleware);
professionalProfileRouter.get("/", getProfile);
professionalProfileRouter.put("/", validateRequest(professionalProfileInputSchema), saveProfile);
professionalProfileRouter.post("/knowledge/preview", validateRequest(profileKnowledgePreviewSchema), previewProfileExport);
professionalProfileRouter.post("/knowledge", validateRequest(profileKnowledgeSaveSchema), saveProfileExport);
