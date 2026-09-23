import { createHash, createPrivateKey, randomBytes, randomUUID, sign } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { createSignal, findSignalByPlanning } from "../repositories/signal.repository.js";
import type { CreateSignalInput } from "../validation/signal.validation.js";
import { claimGithubActivityConversion, claimGithubSync, createGithubOauthState, consumeGithubOauthState, disconnectGithubConnection, findGithubConnection, findGithubOauthState, listGithubActivities, markGithubActivitySignal, setGithubOauthInstallation, updateGithubConnection, upsertGithubActivity } from "../repositories/github.repository.js";
import { decryptGithubSecret, encryptGithubSecret } from "./github-crypto.js";

const redirectPath = "/dashboard?tab=connections";
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const random = () => randomBytes(32).toString("base64url");
function configured() { if (!env.GITHUB_ENABLED || !env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET || !env.GITHUB_APP_ID || !env.GITHUB_APP_SLUG || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_REDIRECT_URI || !env.GITHUB_TOKEN_ENCRYPTION_KEY) throw new AppError(503, "GITHUB_NOT_CONFIGURED", "GitHub is not configured for this environment."); }
class GithubRateLimitError extends Error {
  constructor(public readonly retryAt: Date) { super("GitHub rate limit reached; try again later."); }
}
export function githubRetryAt(status: number, headers: Pick<Headers, "get">, now = Date.now()): Date | null {
  if (status !== 429 && !(status === 403 && headers.get("x-ratelimit-remaining") === "0")) return null;
  const retryAfter = Number(headers.get("retry-after") ?? "");
  const reset = Number(headers.get("x-ratelimit-reset") ?? "");
  const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Number.isFinite(reset) && reset > now / 1000 ? reset * 1000 - now : 60_000;
  return new Date(now + Math.min(Math.max(delay, 30_000), 60 * 60_000));
}
function githubError(status: number, headers?: Headers): never {
  if (status === 401) throw new AppError(409, "GITHUB_REVOKED", "GitHub access was revoked. Reconnect the account.");
  if (githubAccessDenied(status, headers ?? new Headers())) throw new AppError(403, "GITHUB_FORBIDDEN", "GitHub denied access to this resource.");
  if (status === 403 || status === 429) {
    throw new GithubRateLimitError(githubRetryAt(status, headers ?? new Headers()) ?? new Date(Date.now() + 60_000));
  }
  throw new AppError(502, "GITHUB_UNAVAILABLE", "GitHub could not provide the requested data.");
}
async function api(path: string, token?: string) { const response = await fetch(`https://api.github.com${path}`, { headers: { accept: "application/vnd.github+json", "user-agent": "DevSignal-AI", ...(token ? { authorization: `Bearer ${token}` } : {}) }, redirect: "error" }); if (!response.ok) githubError(response.status, response.headers); return response.json() as Promise<unknown>; }
async function apiPage(path: string, token: string) {
  const response = await fetch(`https://api.github.com${path}`, { headers: { accept: "application/vnd.github+json", "user-agent": "DevSignal-AI", authorization: `Bearer ${token}` }, redirect: "error" });
  if (!response.ok) githubError(response.status, response.headers);
  const next = githubNextLink(response.headers.get("link"));
  return { body: await response.json() as unknown, next };
}
export function githubNextLink(link: string | null): string | null {
  return /<([^>]+)>;\s*rel="next"/.exec(link ?? "")?.[1] ?? null;
}
export function githubAccessDenied(status: number, headers: Pick<Headers, "get">): boolean {
  return status === 403 && headers.get("x-ratelimit-remaining") !== "0";
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object") throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid response."); return value as Record<string, unknown>; }
function appJwt() {
  configured();
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000) - 60, exp: Math.floor(Date.now() / 1000) + 540, iss: env.GITHUB_APP_ID })).toString("base64url");
  const input = `${header}.${payload}`;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), createPrivateKey(privateKey)).toString("base64url")}`;
}
async function installationToken(installationId: number) {
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, { method: "POST", headers: { accept: "application/vnd.github+json", "user-agent": "DevSignal-AI", authorization: `Bearer ${appJwt()}` }, redirect: "error" });
  if (!response.ok) githubError(response.status, response.headers);
  const body = record(await response.json());
  if (typeof body.token !== "string" || typeof body.expires_at !== "string") throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid installation token.");
  return { token: body.token, expiresAt: new Date(body.expires_at) };
}
export function getGithubStatus(ownerId: string) {
  if (!env.GITHUB_ENABLED) return Promise.resolve({ enabled: false, status: "not_configured" as const, repositories: [] });
  return findGithubConnection(ownerId).then((connection) => connection ? { enabled: true, status: connection.status, identity: { login: connection.login, githubUserId: connection.githubUserId }, repositories: connection.repositories, sync: connection.sync } : { enabled: true, status: "disconnected" as const, repositories: [] });
}

export async function beginGithubConnection(ownerId: string, sessionCookie: string) {
  configured(); if (!sessionCookie) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
  const existing = await findGithubConnection(ownerId); const state = random();
  await createGithubOauthState({ stateHash: hash(state), ownerId, sessionHash: hash(sessionCookie), expiresAt: new Date(Date.now() + 10 * 60_000), connectionGeneration: existing?.connectionGeneration ?? 0 });
  const query = new URLSearchParams({ state, setup_action: "install" });
  return { authorizationUrl: `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?${query}` };
}

async function exchangeUserCode(code: string) {
  const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, code, redirect_uri: env.GITHUB_REDIRECT_URI }), redirect: "error" });
  if (!response.ok) githubError(response.status);
  const body = record(await response.json());
  if (typeof body.access_token !== "string") throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid user authorization.");
  return body.access_token;
}

export async function completeGithubConnection(state: string | undefined, installationIdValue: string | undefined, code: string | undefined, sessionCookie: string | undefined) {
  const failure = `${env.WEB_ORIGIN}${redirectPath}&github=error`; if (!state || !sessionCookie) return failure;
  const stateHash = hash(state); const sessionHash = hash(sessionCookie); const now = new Date();
  const pending = await findGithubOauthState(stateHash, sessionHash, now); if (!pending) return failure;
  configured();
  const installationId = Number(installationIdValue ?? pending.pendingInstallationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return failure;
  if (!code) {
    const installation = record(await api(`/app/installations/${installationId}`, appJwt()));
    if (!installation.id || Number(installation.id) !== installationId) return failure;
    await setGithubOauthInstallation(stateHash, sessionHash, installationId);
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID!);
    authorize.searchParams.set("redirect_uri", env.GITHUB_REDIRECT_URI!);
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("allow_signup", "false");
    return authorize.toString();
  }
  const consumed = await consumeGithubOauthState(stateHash, sessionHash, now);
  if (!consumed?.pendingInstallationId || consumed.pendingInstallationId !== installationId) return failure;
  const userToken = await exchangeUserCode(code);
  const user = record(await api("/user", userToken));
  const installations = record(await api("/user/installations?per_page=100", userToken));
  if (!Array.isArray(installations.installations) || !installations.installations.some((item) => Number(record(item).id) === installationId)) return failure;
  const tokenResult = await installationToken(installationId);
  const installation = record(await api(`/app/installations/${installationId}`, appJwt()));
  const existing = await findGithubConnection(String(consumed.ownerId));
  if (existing && existing.connectionGeneration !== consumed.connectionGeneration) return `${env.WEB_ORIGIN}${redirectPath}&github=stale`;
  if (typeof user.id !== "number" || typeof user.login !== "string") return failure;
  const repositories = await listGithubRepositories(tokenResult.token);
  const values = { githubUserId: String(user.id), login: String(user.login), installationId, accessTokenEncrypted: encryptGithubSecret(tokenResult.token, env.GITHUB_TOKEN_ENCRYPTION_KEY!), accessTokenExpiresAt: tokenResult.expiresAt, status: "connected", repositories, connectionGeneration: (existing?.connectionGeneration ?? 0) + 1 };
  if (existing) await updateGithubConnection(String(consumed.ownerId), values);
  else await (await import("../repositories/github.repository.js")).createGithubConnection({ ownerId: consumed.ownerId, ...values });
  return `${env.WEB_ORIGIN}${redirectPath}&github=connected`;
}

async function listGithubRepositories(token: string) {
  const values = await api("/installation/repositories?per_page=100", token); if (!Array.isArray(values)) throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned invalid repositories.");
  return values.slice(0, 50).map((item) => { const repo = record(item); return { id: Number(repo.id), fullName: String(repo.full_name ?? ""), private: repo.private === true, defaultBranch: String(repo.default_branch ?? "main"), selected: true }; }).filter((repo) => Number.isFinite(repo.id) && repo.fullName);
}

export async function selectGithubRepositories(ownerId: string, repositoryIds: number[]) {
  const connection = await findGithubConnection(ownerId); if (!connection || connection.status !== "connected") throw new AppError(409, "GITHUB_NOT_CONNECTED", "Connect GitHub before selecting repositories.");
  const selected = connection.repositories.filter((repo) => repositoryIds.includes(repo.id)); if (!selected.length) throw new AppError(400, "GITHUB_REPOSITORIES_REQUIRED", "Select at least one repository.");
  return updateGithubConnection(ownerId, { repositories: connection.repositories.map((repo) => ({ ...repo, selected: repositoryIds.includes(repo.id) })), connectionGeneration: connection.connectionGeneration + 1 });
}
export async function disconnectGithub(ownerId: string) { configured(); await disconnectGithubConnection(ownerId); }

type GithubKind = "commit" | "pull_request" | "release";
type SyncProgress = { repositoryId: number; kind: GithubKind; cursor?: string | null; page: number; complete: boolean; lastOccurredAt?: Date | null };
function progressFor(progress: SyncProgress[] | undefined, repositoryId: number, kind: GithubKind): SyncProgress {
  return progress?.find((value) => value.repositoryId === repositoryId && value.kind === kind) ?? { repositoryId, kind, page: 1, complete: false, cursor: null, lastOccurredAt: null };
}
function timestamp(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}
async function ensureInstallationToken(connection: Awaited<ReturnType<typeof findGithubConnection>>, ownerId: string) {
  if (!connection) throw new AppError(409, "GITHUB_NOT_CONNECTED", "Connect GitHub before syncing.");
  if (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now() + 120_000) return decryptGithubSecret(connection.accessTokenEncrypted, env.GITHUB_TOKEN_ENCRYPTION_KEY!);
  const fresh = await installationToken(connection.installationId);
  await updateGithubConnection(ownerId, { accessTokenEncrypted: encryptGithubSecret(fresh.token, env.GITHUB_TOKEN_ENCRYPTION_KEY!), accessTokenExpiresAt: fresh.expiresAt });
  return fresh.token;
}
async function syncKind(ownerId: string, connection: NonNullable<Awaited<ReturnType<typeof findGithubConnection>>>, repo: { id: number; fullName: string }, kind: GithubKind, token: string, progress: SyncProgress[]) {
  let state = progressFor(progress, repo.id, kind);
  if (state.complete) state = { ...state, page: 1, complete: false };
  const since = state.cursor ?? new Date(Date.now() - env.GITHUB_INITIAL_HISTORY_DAYS * 86_400_000).toISOString();
  for (let count = 0; count < env.GITHUB_SYNC_MAX_PAGES_PER_PASS && !state.complete; count += 1) {
    const path = kind === "commit" ? `/repos/${repo.fullName}/commits?per_page=100&page=${state.page}&since=${encodeURIComponent(since)}` : kind === "pull_request" ? `/repos/${repo.fullName}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${state.page}` : `/repos/${repo.fullName}/releases?per_page=100&page=${state.page}`;
    const page = await apiPage(path, token);
    const current = await findGithubConnection(ownerId);
    if (!current || current.status !== "connected" || current.connectionGeneration !== connection.connectionGeneration) throw new AppError(409, "GITHUB_CONNECTION_CHANGED", "GitHub connection changed during synchronization.");
    if (!Array.isArray(page.body)) throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned invalid activity data.");
    let newest = state.lastOccurredAt?.toISOString() ?? state.cursor ?? null;
    for (const item of page.body) {
      const value = record(item);
      const occurred = kind === "commit" ? timestamp(record(record(value.commit).author).date) : kind === "pull_request" ? timestamp(value.merged_at) : timestamp(value.published_at ?? value.created_at);
      if (!occurred || (kind === "pull_request" && value.merged_at == null)) continue;
      if (occurred > since) {
        const authorSource = kind === "commit" ? value.author : kind === "release" ? value.author : value.user;
        const authorLogin = authorSource && typeof authorSource === "object" ? String(record(authorSource).login ?? "") : null;
        const summary = kind === "commit" ? String(record(value.commit).message ?? "") : String(value.body ?? "");
        await upsertGithubActivity({ ownerId, connectionGeneration: connection.connectionGeneration, repositoryId: repo.id, repositoryFullName: repo.fullName, kind, providerId: String(kind === "commit" ? value.sha : value.id), title: kind === "commit" ? summary.split("\n")[0] : String(value.title ?? value.name ?? value.tag_name ?? ""), summary, url: String(value.html_url ?? ""), occurredAt: new Date(occurred), authorLogin, isPersonal: authorLogin === connection.login, importedAt: new Date() });
      }
      if (!newest || occurred > newest) newest = occurred;
    }
    state = { ...state, cursor: newest, lastOccurredAt: newest ? new Date(newest) : (state.lastOccurredAt ?? null), page: page.next ? state.page + 1 : 1, complete: !page.next };
    const existingIndex = progress.findIndex((value) => value.repositoryId === repo.id && value.kind === kind);
    if (existingIndex >= 0) progress.splice(existingIndex, 1, state);
    else progress.push(state);
    await updateGithubConnection(ownerId, { "sync.progress": progress });
  }
}
export async function syncGithubActivities(ownerId: string) {
  const before = await findGithubConnection(ownerId);
  if (!before || before.status !== "connected") throw new AppError(409, "GITHUB_NOT_CONNECTED", "Connect GitHub before syncing.");
  if (before.sync?.nextEligibleAt && before.sync.nextEligibleAt.getTime() > Date.now()) throw new AppError(429, "GITHUB_RATE_LIMITED", `GitHub sync is delayed until ${before.sync.nextEligibleAt.toISOString()}.`);
  const connection = await claimGithubSync(ownerId, new Date()); if (!connection || connection.status !== "connected") throw new AppError(409, "GITHUB_SYNC_IN_PROGRESS", "GitHub synchronization is already running.");
  const progress = [...(connection.sync?.progress ?? [])] as SyncProgress[];
  try {
    const token = await ensureInstallationToken(connection, ownerId);
    for (const repo of connection.repositories.filter((value) => value.selected !== false).slice(0, 20)) {
      const current = await findGithubConnection(ownerId);
      if (!current || current.status !== "connected" || current.connectionGeneration !== connection.connectionGeneration) throw new AppError(409, "GITHUB_CONNECTION_CHANGED", "GitHub connection changed during synchronization.");
      for (const kind of ["commit", "pull_request", "release"] as GithubKind[]) await syncKind(ownerId, connection, repo, kind, token, progress);
    }
    await updateGithubConnection(ownerId, { "sync.status": "idle", "sync.lastSuccessAt": new Date(), "sync.lastError": null, "sync.nextEligibleAt": null, "sync.rateLimitResetAt": null });
  } catch (error) {
    if (error instanceof GithubRateLimitError) {
      await updateGithubConnection(ownerId, { "sync.status": "idle", "sync.lastError": error.message, "sync.nextEligibleAt": error.retryAt, "sync.rateLimitResetAt": error.retryAt });
    } else {
      await updateGithubConnection(ownerId, { "sync.status": "error", "sync.lastError": error instanceof AppError ? error.message : "GitHub synchronization failed." });
    }
    throw error;
  }
  return listGithubActivities(ownerId);
}
export function getGithubActivities(ownerId: string, kind?: "commit" | "pull_request" | "release", repositoryId?: number, page = 1) { return listGithubActivities(ownerId, kind, repositoryId, page); }
export async function convertGithubActivity(ownerId: string, activityId: string) {
  const activities = await listGithubActivities(ownerId);
  const item = activities.find((value) => String(value._id) === activityId);
  if (!item) throw new AppError(404, "GITHUB_ACTIVITY_NOT_FOUND", "GitHub activity not found.");
  if (item.convertedSignalId) return item.convertedSignalId.toString();
  const runId = activityId;
  const existingSignal = await findSignalByPlanning(ownerId, runId, "github-activity");
  if (existingSignal) {
    await markGithubActivitySignal(ownerId, activityId, existingSignal._id.toString());
    return existingSignal._id.toString();
  }
  const claim = randomUUID();
  const claimed = await claimGithubActivityConversion(ownerId, activityId, claim);
  if (!claimed) {
    const recovered = await findSignalByPlanning(ownerId, runId, "github-activity");
    if (recovered) {
      await markGithubActivitySignal(ownerId, activityId, recovered._id.toString());
      return recovered._id.toString();
    }
    throw new AppError(409, "GITHUB_ACTIVITY_CONVERSION_IN_PROGRESS", "This activity is already being converted.");
  }
  try {
    const input: CreateSignalInput = { topic: item.title.slice(0, 120).padEnd(5, "-"), notes: `${item.summary.slice(0, 3900)}\n\nSource: ${item.url}`, primaryAudience: "Developers & engineers", contentType: "Technical insight" };
    const signal = await createSignal(ownerId, input, { runId, suggestionId: "github-activity", sourceVersions: [] });
    await markGithubActivitySignal(ownerId, activityId, signal._id.toString());
    return signal._id.toString();
  } catch (error) {
    const recovered = await findSignalByPlanning(ownerId, runId, "github-activity");
    if (recovered) {
      await markGithubActivitySignal(ownerId, activityId, recovered._id.toString());
      return recovered._id.toString();
    }
    throw error;
  }
}
