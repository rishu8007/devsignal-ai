import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import * as githubRepository from "../repositories/github.repository.js";
import { decryptGithubSecret, encryptGithubSecret } from "./github-crypto.js";

const redirectPath = "/dashboard?tab=connections";
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const random = () => randomBytes(32).toString("base64url");

type GithubCallbackQueryFieldPresence = {
  state: boolean;
  installationId: boolean;
  setupAction: boolean;
  code: boolean;
};

function logGithubOAuthDiagnostic(input: {
  generatedInstallationPath: string | null;
  hasState: boolean;
  hasClientId: boolean;
  callbackRouteEntered: boolean;
  callbackQueryFieldPresence: GithubCallbackQueryFieldPresence;
  redirectStage: string;
}): void {
  console.info("[github-oauth]", input);
}

type GithubStore = Pick<typeof githubRepository,
  | "findGithubConnection"
  | "createGithubConnection"
  | "updateGithubConnection"
  | "createGithubOauthState"
  | "findGithubOauthState"
  | "consumeGithubOauthState"
  | "setGithubOauthInstallation"
>;

export type GithubAccountDependencies = {
  repository: GithubStore;
  fetch: typeof fetch;
};

const defaultDependencies: GithubAccountDependencies = {
  repository: githubRepository,
  fetch,
};

export type GithubRepositoryInfo = {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  selected: boolean;
};

export function isGithubAccountConfigured(): boolean {
  const complete = Boolean(
    env.GITHUB_ENABLED &&
      env.GITHUB_APP_CLIENT_ID &&
      env.GITHUB_APP_CLIENT_SECRET &&
      env.GITHUB_APP_ID &&
      env.GITHUB_APP_SLUG &&
      env.GITHUB_APP_PRIVATE_KEY &&
      env.GITHUB_REDIRECT_URI &&
      env.GITHUB_TOKEN_ENCRYPTION_KEY &&
      Buffer.from(env.GITHUB_TOKEN_ENCRYPTION_KEY, "base64").length === 32,
  );
  if (!complete || !env.GITHUB_APP_PRIVATE_KEY) return false;
  try {
    return createPrivateKey(env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n")).asymmetricKeyType === "rsa";
  } catch {
    return false;
  }
}

function requireConfiguration(): void {
  if (!isGithubAccountConfigured()) {
    throw new AppError(503, "GITHUB_NOT_CONFIGURED", "GitHub is not configured for this environment.");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

function appJwt(): string {
  requireConfiguration();
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 540,
    iss: env.GITHUB_APP_ID,
  })).toString("base64url");
  const input = `${header}.${payload}`;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), createPrivateKey(privateKey)).toString("base64url")}`;
}

function providerError(status: number): never {
  if (status === 401) throw new AppError(409, "GITHUB_REVOKED", "GitHub access was revoked. Reconnect the account.", true, undefined, { githubHttpStatus: status });
  if (status === 403 || status === 429) throw new AppError(429, "GITHUB_RATE_LIMITED", "GitHub temporarily denied this request. Try again later.", true, undefined, { githubHttpStatus: status });
  throw new AppError(502, "GITHUB_UNAVAILABLE", "GitHub could not provide the requested data.", true, undefined, { githubHttpStatus: status });
}

async function getJson(url: string | URL, fetchImplementation: typeof fetch, token?: string): Promise<{ body: unknown; next: string | null }> {
  const response = await fetchImplementation(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "DevSignal-AI",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    redirect: "error",
  });
  if (!response.ok) providerError(response.status);
  const link = response.headers.get("link") ?? "";
  const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
  return { body: await response.json() as unknown, next };
}

async function postInstallationToken(installationId: number, fetchImplementation: typeof fetch) {
  const response = await fetchImplementation(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "DevSignal-AI",
        authorization: `Bearer ${appJwt()}`,
      },
      redirect: "error",
    },
  );
  if (!response.ok) providerError(response.status);
  const body = record(await response.json());
  if (typeof body.token !== "string" || typeof body.expires_at !== "string") {
    throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid installation token.");
  }
  const expiresAt = new Date(body.expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid installation token.");
  }
  return { token: body.token, expiresAt };
}

async function fetchInstallationRepositories(token: string, fetchImplementation: typeof fetch): Promise<GithubRepositoryInfo[]> {
  const repositories: GithubRepositoryInfo[] = [];
  let next: string | null = "https://api.github.com/installation/repositories?per_page=100";
  while (next && repositories.length < 50) {
    const url = new URL(next);
    if (url.origin !== "https://api.github.com") {
      throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid pagination link.");
    }
    const page = await getJson(url, fetchImplementation, token);
    const payload = record(page.body);
    if (!Array.isArray(payload.repositories)) {
      throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned invalid repositories.");
    }
    for (const item of payload.repositories) {
      const value = record(item);
      const id = Number(value.id);
      if (!Number.isSafeInteger(id) || id <= 0 || typeof value.full_name !== "string" || !value.full_name) {
        throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned invalid repositories.");
      }
      repositories.push({
        id,
        fullName: value.full_name,
        private: value.private === true,
        defaultBranch: typeof value.default_branch === "string" ? value.default_branch : "main",
        selected: false,
      });
      if (repositories.length >= 50) break;
    }
    next = repositories.length < 50 ? page.next : null;
  }
  return repositories;
}

async function installationTokenForConnection(
  connection: NonNullable<Awaited<ReturnType<GithubStore["findGithubConnection"]>>>,
  ownerId: string,
  dependencies: GithubAccountDependencies,
): Promise<string> {
  if (connection.accessTokenExpiresAt.getTime() > Date.now() + 120_000) {
    return decryptGithubSecret(connection.accessTokenEncrypted, env.GITHUB_TOKEN_ENCRYPTION_KEY!);
  }
  const fresh = await postInstallationToken(connection.installationId, dependencies.fetch);
  await dependencies.repository.updateGithubConnection(ownerId, {
    accessTokenEncrypted: encryptGithubSecret(fresh.token, env.GITHUB_TOKEN_ENCRYPTION_KEY!),
    accessTokenExpiresAt: fresh.expiresAt,
  });
  return fresh.token;
}

export function getGithubAccountStatus(ownerId: string, dependencies = defaultDependencies) {
  if (!isGithubAccountConfigured()) {
    return Promise.resolve({ enabled: false, status: "not_configured" as const, repositories: [] });
  }
  return dependencies.repository.findGithubConnection(ownerId).then((connection) => {
    logGithubOAuthDiagnostic({
      generatedInstallationPath: null,
      hasState: false,
      hasClientId: false,
      callbackRouteEntered: false,
      callbackQueryFieldPresence: { state: false, installationId: false, setupAction: false, code: false },
      redirectStage: "status_lookup",
    });
    return connection
      ? {
          enabled: true,
          status: connection.status,
          identity: { login: connection.login, githubUserId: connection.githubUserId },
          repositories: connection.repositories,
          sync: connection.sync,
        }
      : { enabled: true, status: "disconnected" as const, repositories: [] };
  });
}

export async function beginGithubAccountConnection(ownerId: string, sessionCookie: string | undefined, dependencies = defaultDependencies) {
  requireConfiguration();
  if (!sessionCookie) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
  const existing = await dependencies.repository.findGithubConnection(ownerId);
  const state = random();
  await dependencies.repository.createGithubOauthState({
    stateHash: hash(state),
    ownerId,
    sessionHash: hash(sessionCookie),
    expiresAt: new Date(Date.now() + 10 * 60_000),
    connectionGeneration: existing?.connectionGeneration ?? 0,
  });
  const installationPath = `/apps/${env.GITHUB_APP_SLUG}/installations/new`;
  logGithubOAuthDiagnostic({
    generatedInstallationPath: installationPath,
    hasState: true,
    hasClientId: false,
    callbackRouteEntered: false,
    callbackQueryFieldPresence: { state: false, installationId: false, setupAction: false, code: false },
    redirectStage: "installation_started",
  });
  const query = new URLSearchParams({ state, setup_action: "install" });
  return { authorizationUrl: `https://github.com${installationPath}?${query}` };
}

async function exchangeUserCode(code: string, fetchImplementation: typeof fetch): Promise<string> {
  const response = await fetchImplementation("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: env.GITHUB_REDIRECT_URI,
    }),
    redirect: "error",
  });
  if (!response.ok) {
    throw new AppError(
      502,
      "GITHUB_TOKEN_EXCHANGE_FAILED",
      "GitHub authorization could not be completed.",
      true,
      undefined,
      { githubHttpStatus: response.status },
    );
  }
  const body = record(await response.json());
  if (typeof body.access_token !== "string") {
    throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid user authorization.");
  }
  return body.access_token;
}

export async function completeGithubAccountConnection(
  state: string | undefined,
  installationIdValue: string | undefined,
  code: string | undefined,
  sessionCookie: string | undefined,
  dependencies = defaultDependencies,
  setupAction: string | undefined = undefined,
): Promise<string> {
  const failure = `${env.WEB_ORIGIN}${redirectPath}&github=error`;
  const callbackQueryFieldPresence = {
    state: Boolean(state),
    installationId: Boolean(installationIdValue),
    setupAction: Boolean(setupAction),
    code: Boolean(code),
  };
  const report = (redirectStage: string) => logGithubOAuthDiagnostic({
    generatedInstallationPath: null,
    hasState: Boolean(state),
    hasClientId: redirectStage === "oauth_authorization",
    callbackRouteEntered: true,
    callbackQueryFieldPresence,
    redirectStage,
  });

  try {
    if (!state || !sessionCookie) {
      report("callback_rejected");
      return failure;
    }
    const stateHash = hash(state);
    const sessionHash = hash(sessionCookie);
    const now = new Date();
    const pending = await dependencies.repository.findGithubOauthState(stateHash, sessionHash, now);
    if (!pending) {
      report("state_rejected");
      return failure;
    }
    if (!isGithubAccountConfigured()) {
      report("configuration_unavailable");
      return `${env.WEB_ORIGIN}${redirectPath}&github=unavailable`;
    }
    const installationId = Number(installationIdValue ?? pending.pendingInstallationId);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      report("installation_id_missing");
      return failure;
    }

    if (!code) {
      const { body } = await getJson(
        `https://api.github.com/app/installations/${installationId}`,
        dependencies.fetch,
        appJwt(),
      );
      const installation = record(body);
      if (!installation.id || Number(installation.id) !== installationId) {
        report("installation_verification_failed");
        return failure;
      }
      const updated = await dependencies.repository.setGithubOauthInstallation(stateHash, sessionHash, installationId, now);
      if (updated.modifiedCount !== 1) {
        report("installation_state_update_failed");
        return failure;
      }
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID!);
      authorize.searchParams.set("redirect_uri", env.GITHUB_REDIRECT_URI!);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("allow_signup", "false");
      report("oauth_authorization");
      return authorize.toString();
    }

    const consumed = await dependencies.repository.consumeGithubOauthState(stateHash, sessionHash, now);
    if (!consumed?.pendingInstallationId || consumed.pendingInstallationId !== installationId) {
      report("state_rejected");
      return failure;
    }
    const userToken = await exchangeUserCode(code, dependencies.fetch);
    const userResult = await getJson("https://api.github.com/user", dependencies.fetch, userToken);
    const user = record(userResult.body);
    if (typeof user.id !== "number" || typeof user.login !== "string") {
      throw new AppError(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid user.");
    }
    const installationsResult = await getJson("https://api.github.com/user/installations?per_page=100", dependencies.fetch, userToken);
    const installations = record(installationsResult.body);
    if (!Array.isArray(installations.installations) || !installations.installations.some((item) => Number(record(item).id) === installationId)) {
      report("installation_not_authorized");
      return failure;
    }

    const token = await postInstallationToken(installationId, dependencies.fetch);
    const ownerId = String(consumed.ownerId);
    const existing = await dependencies.repository.findGithubConnection(ownerId);
    if (existing && existing.connectionGeneration !== consumed.connectionGeneration) {
      report("connection_stale");
      return `${env.WEB_ORIGIN}${redirectPath}&github=stale`;
    }
    const available = await fetchInstallationRepositories(token.token, dependencies.fetch);
    const previouslySelected = new Set((existing?.repositories ?? []).map((repository) => repository.id));
    const selected = available
      .filter((repository) => previouslySelected.has(repository.id))
      .map(({ id, fullName }) => ({ id, fullName }));
    const connectionData = {
      githubUserId: String(user.id),
      login: user.login,
      installationId,
      accessTokenEncrypted: encryptGithubSecret(token.token, env.GITHUB_TOKEN_ENCRYPTION_KEY!),
      accessTokenExpiresAt: token.expiresAt,
      status: "connected",
      repositories: selected,
      connectionGeneration: (existing?.connectionGeneration ?? 0) + 1,
    };
    const persisted = existing
      ? await dependencies.repository.updateGithubConnection(ownerId, connectionData)
      : await dependencies.repository.createGithubConnection({ ownerId: consumed.ownerId, ...connectionData });
    if (!persisted) {
      report("connection_persist_failed");
      return failure;
    }
    report("connection_persisted");
    return `${env.WEB_ORIGIN}${redirectPath}&github=connected`;
  } catch (error) {
    report(error instanceof AppError ? error.code : "callback_error");
    return failure;
  }
}

export async function listGithubRepositoriesForUser(ownerId: string, dependencies = defaultDependencies): Promise<GithubRepositoryInfo[]> {
  requireConfiguration();
  const connection = await dependencies.repository.findGithubConnection(ownerId);
  if (!connection || connection.status !== "connected") {
    throw new AppError(409, "GITHUB_NOT_CONNECTED", "Connect GitHub before listing repositories.");
  }
  const token = await installationTokenForConnection(connection, ownerId, dependencies);
  const selectedIds = new Set(connection.repositories.map((repository) => repository.id));
  return (await fetchInstallationRepositories(token, dependencies.fetch))
    .map((repository) => ({ ...repository, selected: selectedIds.has(repository.id) }));
}

export async function saveGithubRepositorySelection(
  ownerId: string,
  repositoryIds: number[],
  dependencies = defaultDependencies,
): Promise<Array<{ id: number; fullName: string }>> {
  requireConfiguration();
  const connection = await dependencies.repository.findGithubConnection(ownerId);
  if (!connection || connection.status !== "connected") {
    throw new AppError(409, "GITHUB_NOT_CONNECTED", "Connect GitHub before selecting repositories.");
  }
  if (new Set(repositoryIds).size !== repositoryIds.length) {
    throw new AppError(400, "GITHUB_REPOSITORIES_INVALID", "Repository selection contains duplicates.");
  }
  const token = await installationTokenForConnection(connection, ownerId, dependencies);
  const available = await fetchInstallationRepositories(token, dependencies.fetch);
  const byId = new Map(available.map((repository) => [repository.id, repository]));
  if (repositoryIds.some((repositoryId) => !byId.has(repositoryId))) {
    throw new AppError(400, "GITHUB_REPOSITORY_NOT_AUTHORIZED", "One or more repositories are not available to this GitHub installation.");
  }
  const selected = repositoryIds.map((repositoryId) => {
    const repository = byId.get(repositoryId);
    if (!repository) {
      throw new AppError(400, "GITHUB_REPOSITORY_NOT_AUTHORIZED", "One or more repositories are not available to this GitHub installation.");
    }
    return { id: repository.id, fullName: repository.fullName };
  });
  const updated = await dependencies.repository.updateGithubConnection(ownerId, {
    repositories: selected,
    connectionGeneration: connection.connectionGeneration + 1,
  });
  if (!updated) throw new AppError(503, "GITHUB_CONNECTION_UPDATE_FAILED", "GitHub repository selection could not be saved.");
  return selected;
}
