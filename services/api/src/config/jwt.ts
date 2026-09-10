import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { env } from "./env.js";

export function createAccessToken(userId: string): string {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    audience: env.JWT_AUDIENCE,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    issuer: env.JWT_ISSUER,
    subject: userId,
  });
}

export function getAuthenticatedUserId(token: string): string | null {
  try {
    const decoded: unknown = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      audience: env.JWT_AUDIENCE,
      issuer: env.JWT_ISSUER,
    });

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("sub" in decoded) ||
      typeof decoded.sub !== "string" ||
      !/^[a-f\d]{24}$/i.test(decoded.sub) ||
      !Types.ObjectId.isValid(decoded.sub)
    ) {
      return null;
    }

    return decoded.sub;
  } catch {
    return null;
  }
}
