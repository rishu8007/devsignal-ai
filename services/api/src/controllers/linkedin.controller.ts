import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  beginLinkedInConnection,
  completeLinkedInConnection,
  disconnectLinkedInConnection,
  getLinkedInStatus,
} from "../services/linkedin-connection.service.js";

function userId(request: Request): string {
  const value = request.auth?.userId;
  if (!value) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
  return value;
}

export async function linkedinStatus(request: Request, response: Response): Promise<void> {
  response.status(200).json({ success: true, data: await getLinkedInStatus(userId(request)) });
}

export async function linkedinConnect(request: Request, response: Response): Promise<void> {
  const cookie = request.cookies?.[env.AUTH_COOKIE_NAME];
  const result = await beginLinkedInConnection(userId(request), cookie, request.body.returnPath, request.body.posting);
  response.status(200).json({ success: true, data: result });
}

export async function linkedinPostingConsent(request: Request, response: Response): Promise<void> {
  const cookie = request.cookies?.[env.AUTH_COOKIE_NAME];
  const result = await beginLinkedInConnection(userId(request), cookie, request.body.returnPath, true);
  response.status(200).json({ success: true, data: result });
}

export async function linkedinCallback(request: Request, response: Response): Promise<void> {
  const redirect = await completeLinkedInConnection(
    typeof request.query.state === "string" ? request.query.state : undefined,
    typeof request.query.code === "string" ? request.query.code : undefined,
    typeof request.query.error === "string" ? request.query.error : undefined,
    request.cookies?.[env.AUTH_COOKIE_NAME],
  );
  response.redirect(303, redirect);
}

export async function linkedinDisconnect(request: Request, response: Response): Promise<void> {
  await disconnectLinkedInConnection(userId(request));
  response.status(200).json({ success: true, data: { disconnected: true, remoteRevoked: false } });
}
