import { Router } from "express";
import { getMe, login, logout, register } from "../controllers/auth.controller.js";
import { authRateLimitMiddleware } from "../middleware/auth-rate-limit.middleware.js";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { loginRateLimitMiddleware } from "../middleware/login-rate-limit.middleware.js";
import { validateRequest } from "../middleware/validate-request.middleware.js";
import { loginSchema, registerSchema } from "../validation/auth.validation.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  authRateLimitMiddleware,
  validateRequest(registerSchema),
  register,
);
authRouter.post("/login", loginRateLimitMiddleware, validateRequest(loginSchema), login);
authRouter.get("/me", authenticationMiddleware, getMe);
authRouter.post("/logout", logout);
