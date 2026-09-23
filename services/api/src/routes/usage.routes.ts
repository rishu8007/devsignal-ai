import { Router } from "express";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { getUsage } from "../controllers/usage.controller.js";
export const usageRouter = Router();
usageRouter.get("/", authenticationMiddleware, getUsage);
