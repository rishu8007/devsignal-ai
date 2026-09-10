import type { CookieOptions } from "express";
import { env } from "./env.js";

export function getAuthCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}
