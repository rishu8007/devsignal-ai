import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { getAuthCookieOptions } from "../config/auth-cookie.js";
import { AppError } from "../errors/app-error.js";
import { getCurrentUser, loginUser, registerUser } from "../services/auth.service.js";

export async function register(request: Request, response: Response): Promise<void> {
  const user = await registerUser(request.body);
  response.status(201).json({
    success: true,
    data: {
      user,
    },
  });
}

export async function login(request: Request, response: Response): Promise<void> {
  const result = await loginUser(request.body);
  response.cookie(env.AUTH_COOKIE_NAME, result.token, {
    ...getAuthCookieOptions(),
    maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000,
  });
  response.status(200).json({
    success: true,
    data: {
      user: result.user,
    },
  });
}

export async function getMe(request: Request, response: Response): Promise<void> {
  const userId = request.auth?.userId;

  if (!userId) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  const user = await getCurrentUser(userId);
  response.status(200).json({
    success: true,
    data: {
      user,
    },
  });
}

export function logout(_request: Request, response: Response): void {
  response.clearCookie(env.AUTH_COOKIE_NAME, getAuthCookieOptions());
  response.status(200).json({
    success: true,
    data: {
      message: "Logged out successfully",
    },
  });
}
