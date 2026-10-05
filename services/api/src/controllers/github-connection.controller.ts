import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { beginGithubAccountConnection, completeGithubAccountConnection, getGithubAccountStatus, listGithubRepositoriesForUser, saveGithubRepositorySelection } from "../services/github-account.service.js";
import { convertGithubActivity, disconnectGithub, getGithubActivities, syncGithubActivities } from "../services/github-connection.service.js";
function owner(request: Request) { if (!request.auth?.userId) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required."); return request.auth.userId; }
export async function githubStatus(request: Request, response: Response) { response.json({ success: true, data: await getGithubAccountStatus(owner(request)) }); }
export async function githubRepositoryList(request: Request, response: Response) { response.json({ success: true, data: { repositories: await listGithubRepositoriesForUser(owner(request)) } }); }
export async function githubConnect(request: Request, response: Response) { const cookie = request.cookies?.[env.AUTH_COOKIE_NAME]; response.json({ success: true, data: await beginGithubAccountConnection(owner(request), cookie) }); }
export async function githubCallback(request: Request, response: Response) {
  const callbackQueryFieldPresence = {
    state: Object.hasOwn(request.query, "state"),
    installationId: Object.hasOwn(request.query, "installation_id"),
    setupAction: Object.hasOwn(request.query, "setup_action"),
    code: Object.hasOwn(request.query, "code"),
  };
  const state = typeof request.query.state === "string" ? request.query.state : undefined;
  const installationId = typeof request.query.installation_id === "string" ? request.query.installation_id : undefined;
  const code = typeof request.query.code === "string" ? request.query.code : undefined;
  const setupAction = typeof request.query.setup_action === "string" ? request.query.setup_action : undefined;
  console.info("[github-oauth]", {
    generatedInstallationPath: null,
    hasState: Boolean(state),
    hasClientId: false,
    callbackRouteEntered: true,
    callbackQueryFieldPresence,
    redirectStage: "callback_route_entered",
  });
  response.redirect(303, await completeGithubAccountConnection(
    state,
    installationId,
    code,
    request.cookies?.[env.AUTH_COOKIE_NAME],
    undefined,
    setupAction,
  ));
}
export async function githubDisconnect(request: Request, response: Response) { await disconnectGithub(owner(request)); response.json({ success: true, data: { disconnected: true } }); }
export async function githubRepositories(request: Request, response: Response) { response.json({ success: true, data: { repositories: await saveGithubRepositorySelection(owner(request), request.body.repositoryIds) } }); }
export async function githubSync(request: Request, response: Response) { response.json({ success: true, data: { activities: await syncGithubActivities(owner(request)) } }); }
export async function githubActivities(request: Request, response: Response) { const value = typeof request.query.kind === "string" ? request.query.kind : undefined; const kind = value === "commit" || value === "pull_request" || value === "release" ? value : undefined; const repositoryId = typeof request.query.repositoryId === "number" ? request.query.repositoryId : undefined; const page = typeof request.query.page === "number" ? request.query.page : 1; response.json({ success: true, data: { activities: await getGithubActivities(owner(request), kind, repositoryId, page), page } }); }
export async function githubConvertActivity(request: Request, response: Response) { const activityId = request.params.activityId; if (typeof activityId !== "string") throw new AppError(400, "VALIDATION_ERROR", "Invalid activity identifier."); response.json({ success: true, data: { signalId: await convertGithubActivity(owner(request), activityId) } }); }
