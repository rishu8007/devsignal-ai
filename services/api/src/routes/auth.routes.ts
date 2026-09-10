import { Router } from "express";
import { register } from "../controllers/auth.controller.js";
import { authRateLimitMiddleware } from "../middleware/auth-rate-limit.middleware.js";
import { validateRequest } from "../middleware/validate-request.middleware.js";
import { registerSchema } from "../validation/auth.validation.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  authRateLimitMiddleware,
  validateRequest(registerSchema),
  register,
);
