import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import type { Request, Response } from "express";
import test from "node:test";
import { env } from "../src/config/env.js";
import { githubCallback } from "../src/controllers/github-connection.controller.js";
import { decryptGithubSecret } from "../src/services/github-crypto.js";
import {
  beginGithubAccountConnection,
  completeGithubAccountConnection,
  getGithubAccountStatus,
  isGithubAccountConfigured,
  listGithubRepositoriesForUser,
  saveGithubRepositorySelection,
  type GithubAccountDependencies,
} from "../src/services/github-account.service.js";

const ownerId = "64b000000000000000000001";
const sessionCookie = "synthetic-session-cookie";
const tokenEncryptionKey = Buffer.alloc(32, 21).toString("base64");
const syntheticClientSecret = "synthetic-client-secret-not-real";
const syntheticAccessToken = "synthetic-installation-token-not-real";
const syntheticPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

function configureGithub() {
  const mutable = env as typeof env & Record<string, unknown>;
  mutable.GITHUB_ENABLED = true;
  mutable.GITHUB_APP_CLIENT_ID = "synthetic-client-id";
  mutable.GITHUB_APP_CLIENT_SECRET = syntheticClientSecret;
  mutable.GITHUB_APP_ID = 987654;
  mutable.GITHUB_APP_SLUG = "synthetic-test-app";
  mutable.GITHUB_APP_PRIVATE_KEY = syntheticPrivateKey;
  mutable.GITHUB_REDIRECT_URI = "http://localhost:4000/api/v1/connections/github/callback";
  mutable.GITHUB_TOKEN_ENCRYPTION_KEY = tokenEncryptionKey;
  mutable.GITHUB_SYNC_ENABLED = false;
}

function makeDependencies(initialConnection?: Record<string, unknown>): {
  dependencies: GithubAccountDependencies;
  data: {
    state: Record<string, unknown> | null;
    connection: Record<string, unknown> | null;
    createInput: Record<string, unknown> | null;
    updateInput: Record<string, unknown> | null;
    updateOwnerId: string | null;
    consumed: boolean;
  };
} {
  const data = {
    state: null as Record<string, unknown> | null,
    connection: initialConnection ?? null,
    createInput: null as Record<string, unknown> | null,
    updateInput: null as Record<string, unknown> | null,
    updateOwnerId: null as string | null,
    consumed: false,
  };
  const repository = {
    findGithubConnection: async (requestedOwner: string) =>
      requestedOwner === ownerId ? data.connection as never : null,
    createGithubConnection: async (input: Record<string, unknown>) => {
      data.createInput = input;
      data.connection = input;
      return input as never;
    },
    updateGithubConnection: async (requestedOwner: string, input: Record<string, unknown>) => {
      if (requestedOwner !== ownerId || !data.connection) return null;
      data.updateOwnerId = requestedOwner;
      data.updateInput = input;
      data.connection = { ...data.connection, ...input };
      return data.connection as never;
    },
    createGithubOauthState: async (input: Record<string, unknown>) => {
      data.state = input;
      return input as never;
    },
    findGithubOauthState: async (stateHash: string, sessionHash: string, now: Date) => {
      const state = data.state;
      return state &&
        state.stateHash === stateHash &&
        state.sessionHash === sessionHash &&
        (state.expiresAt as Date) > now &&
        !data.consumed
        ? state as never
        : null;
    },
    consumeGithubOauthState: async (stateHash: string, sessionHash: string, now: Date) => {
      const state = data.state;
      if (!state || state.stateHash !== stateHash || state.sessionHash !== sessionHash ||
        (state.expiresAt as Date) <= now || data.consumed) return null;
      data.consumed = true;
      return state as never;
    },
    setGithubOauthInstallation: async (stateHash: string, sessionHash: string, installationId: number, now: Date) => {
      const state = data.state;
      if (!state || state.stateHash !== stateHash || state.sessionHash !== sessionHash ||
        (state.expiresAt as Date) <= now || data.consumed) return { modifiedCount: 0 };
      state.pendingInstallationId = installationId;
      return { modifiedCount: 1 };
    },
  };
  return {
    dependencies: { repository: repository as never, fetch: fetch as typeof fetch },
    data,
  };
}

function providerResponse(body: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers).entries()) },
  });
}

test("incomplete or disabled GitHub configuration reports unavailable without crashing", async () => {
  configureGithub();
  const mutable = env as typeof env & Record<string, unknown>;
  mutable.GITHUB_APP_CLIENT_SECRET = undefined;
  assert.equal(isGithubAccountConfigured(), false);
  const status = await getGithubAccountStatus(ownerId);
  assert.equal(status.enabled, false);
  assert.equal(status.status, "not_configured");
  await assert.rejects(
    beginGithubAccountConnection(ownerId, sessionCookie),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "GITHUB_NOT_CONFIGURED",
  );
  mutable.GITHUB_ENABLED = false;
  mutable.GITHUB_APP_CLIENT_SECRET = syntheticClientSecret;
  assert.equal((await getGithubAccountStatus(ownerId)).status, "not_configured");
  mutable.GITHUB_ENABLED = true;
  mutable.GITHUB_APP_PRIVATE_KEY = "not-a-private-key";
  assert.equal(isGithubAccountConfigured(), false);
});

test("OAuth state is random, stored hashed, bound to session, and expires", async () => {
  configureGithub();
  const { dependencies, data } = makeDependencies();
  const started = await beginGithubAccountConnection(ownerId, sessionCookie, dependencies);
  const firstState = new URL(started.authorizationUrl).searchParams.get("state");
  assert.ok(firstState);
  assert.notEqual(data.state?.stateHash, firstState);
  assert.equal(data.state?.sessionHash, (await import("node:crypto")).createHash("sha256").update(sessionCookie).digest("base64url"));

  const mismatch = await completeGithubAccountConnection(firstState, "99", undefined, "other-session", dependencies);
  assert.match(mismatch, /github=error/);

  data.state!.expiresAt = new Date(Date.now() - 1);
  const expired = await completeGithubAccountConnection(firstState, "99", undefined, sessionCookie, dependencies);
  assert.match(expired, /github=error/);
});

test("installation URL diagnostics expose only safe path and parameter-presence values", async () => {
  configureGithub();
  const { dependencies } = makeDependencies();
  const diagnostics: unknown[][] = [];
  const originalInfo = console.info;
  console.info = (...values: unknown[]) => {
    if (values[0] === "[github-oauth]") diagnostics.push(values);
  };
  let authorizationUrl = "";
  try {
    authorizationUrl = (await beginGithubAccountConnection(ownerId, sessionCookie, dependencies)).authorizationUrl;
  } finally {
    console.info = originalInfo;
  }
  const url = new URL(authorizationUrl);
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/apps/synthetic-test-app/installations/new");
  assert.equal(url.searchParams.get("setup_action"), "install");
  assert.ok(url.searchParams.get("state"));
  assert.equal(url.searchParams.has("client_id"), false);
  const [, diagnostic] = diagnostics[0] ?? [];
  assert.deepEqual(diagnostic, {
    generatedInstallationPath: "/apps/synthetic-test-app/installations/new",
    hasState: true,
    hasClientId: false,
    callbackRouteEntered: false,
    callbackQueryFieldPresence: { state: false, installationId: false, setupAction: false, code: false },
    redirectStage: "installation_started",
  });
  assert.equal(JSON.stringify(diagnostics).includes(url.searchParams.get("state") ?? ""), false);
});

test("callback route records expected GitHub query fields without logging their values", async () => {
  configureGithub();
  const diagnostics: unknown[][] = [];
  const redirects: Array<{ status: number; location: string }> = [];
  const originalInfo = console.info;
  console.info = (...values: unknown[]) => {
    if (values[0] === "[github-oauth]") diagnostics.push(values);
  };
  try {
    await githubCallback(
      {
        query: { state: "", installation_id: "99", setup_action: "install", code: "synthetic-code" },
        cookies: {},
      } as Request,
      { redirect: (status: number, location: string) => { redirects.push({ status, location }); } } as unknown as Response,
    );
  } finally {
    console.info = originalInfo;
  }
  assert.equal(redirects.length, 1);
  assert.equal(redirects[0]?.status, 303);
  const routeDiagnostic = diagnostics
    .map(([, value]) => value as Record<string, unknown>)
    .find((value) => value["redirectStage"] === "callback_route_entered");
  assert.deepEqual(routeDiagnostic, {
    generatedInstallationPath: null,
    hasState: false,
    hasClientId: false,
    callbackRouteEntered: true,
    callbackQueryFieldPresence: { state: true, installationId: true, setupAction: true, code: true },
    redirectStage: "callback_route_entered",
  });
  assert.equal(JSON.stringify(diagnostics).includes("synthetic-code"), false);
});

test("mocked installation and user OAuth persists an encrypted token and validates replay", async () => {
  configureGithub();
  assert.equal(isGithubAccountConfigured(), true);
  const { dependencies, data } = makeDependencies();
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const mockedFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (url.endsWith("/app/installations/99")) return providerResponse({ id: 99 });
    if (url.endsWith("/login/oauth/access_token")) return providerResponse({ access_token: "synthetic-user-token" });
    if (url.endsWith("/user")) return providerResponse({ id: 7, login: "octocat" });
    if (url.includes("/user/installations")) return providerResponse({ installations: [{ id: 99 }] });
    if (url.endsWith("/app/installations/99/access_tokens")) {
      return providerResponse({ token: syntheticAccessToken, expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    }
    if (url.includes("/installation/repositories")) {
      return providerResponse({
        total_count: 1,
        repositories: [{ id: 42, full_name: "acme/project", private: true, default_branch: "main" }],
      });
    }
    throw new Error(`Unexpected mocked GitHub request: ${url}`);
  };
  dependencies.fetch = mockedFetch;
  const started = await beginGithubAccountConnection(ownerId, sessionCookie, dependencies);
  const installationUrl = new URL(started.authorizationUrl);
  const state = installationUrl.searchParams.get("state");
  assert.equal(installationUrl.pathname, "/apps/synthetic-test-app/installations/new");
  assert.equal(installationUrl.searchParams.get("setup_action"), "install");
  assert.ok(state);
  const diagnostics: unknown[][] = [];
  const originalInfo = console.info;
  console.info = (...values: unknown[]) => { if (values[0] === "[github-oauth]") diagnostics.push(values); };
  let installCallback: string;
  let complete: string;
  let refreshedStatus: Awaited<ReturnType<typeof getGithubAccountStatus>>;
  let anotherOwnerStatus: Awaited<ReturnType<typeof getGithubAccountStatus>>;
  try {
    installCallback = await completeGithubAccountConnection(state, "99", undefined, sessionCookie, dependencies, "install");
    assert.match(installCallback, /github\.com\/login\/oauth\/authorize/);
    const authorizationUrl = new URL(installCallback);
    assert.equal(authorizationUrl.pathname, "/login/oauth/authorize");
    assert.equal(authorizationUrl.searchParams.get("client_id"), "synthetic-client-id");
    assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "http://localhost:4000/api/v1/connections/github/callback");
    complete = await completeGithubAccountConnection(state, "99", "synthetic-code", sessionCookie, dependencies);
    assert.match(complete, /github=connected/);
    refreshedStatus = await getGithubAccountStatus(ownerId, dependencies);
    anotherOwnerStatus = await getGithubAccountStatus("64b000000000000000000002", dependencies);
  } finally {
    console.info = originalInfo;
  }
  assert.equal(data.consumed, true);
  assert.equal(String(data.createInput?.["ownerId"]), ownerId);
  assert.equal(data.createInput?.["status"], "connected");
  assert.equal(data.createInput?.["githubUserId"], "7");
  assert.equal(data.createInput?.["login"], "octocat");
  assert.deepEqual(data.createInput?.["repositories"], []);
  assert.equal(refreshedStatus.status, "connected");
  assert.equal(refreshedStatus.identity?.login, "octocat");
  assert.equal(anotherOwnerStatus.status, "disconnected");
  const safeLogFields = [
    "callbackQueryFieldPresence",
    "callbackRouteEntered",
    "generatedInstallationPath",
    "hasClientId",
    "hasState",
    "redirectStage",
  ];
  for (const [, detail] of diagnostics) {
    assert.deepEqual(Object.keys(detail as object).sort(), safeLogFields);
  }
  assert.ok(diagnostics.some(([, detail]) => {
    const entry = detail as Record<string, unknown>;
    return entry["redirectStage"] === "oauth_authorization" && entry["hasClientId"] === true;
  }));
  assert.ok(diagnostics.some(([, detail]) => {
    const entry = detail as Record<string, unknown>;
    const fields = entry["callbackQueryFieldPresence"] as Record<string, unknown>;
    return entry["redirectStage"] === "oauth_authorization" && fields["setupAction"] === true;
  }));
  assert.ok(diagnostics.some(([, detail]) =>
    (detail as Record<string, unknown>)["redirectStage"] === "connection_persisted"));
  const serializedDiagnostics = JSON.stringify(diagnostics);
  for (const secret of [state, sessionCookie, "synthetic-code", syntheticAccessToken, syntheticPrivateKey, syntheticClientSecret]) {
    assert.equal(serializedDiagnostics.includes(secret), false);
  }
  const encrypted = data.createInput?.["accessTokenEncrypted"];
  assert.equal(typeof encrypted, "string");
  assert.notEqual(encrypted, syntheticAccessToken);
  assert.equal(decryptGithubSecret(String(encrypted), tokenEncryptionKey), syntheticAccessToken);

  const replay = await completeGithubAccountConnection(state, "99", "synthetic-code", sessionCookie, dependencies);
  assert.match(replay, /github=error/);
  assert.equal(requests.filter((request) => request.url.endsWith("/login/oauth/access_token")).length, 1);
  assert.equal(JSON.parse(requests.find((request) => request.url.endsWith("/login/oauth/access_token"))?.body ?? "{}").client_secret, syntheticClientSecret);
});

test("callback failure diagnostics expose query presence and redirect stage without values", async () => {
  configureGithub();
  const { dependencies } = makeDependencies();
  dependencies.fetch = async (input) => {
    if (String(input).endsWith("/app/installations/99")) return providerResponse({ id: 99 });
    if (String(input).endsWith("/login/oauth/access_token")) return new Response(null, { status: 401 });
    throw new Error("Unexpected mocked GitHub request.");
  };
  const started = await beginGithubAccountConnection(ownerId, sessionCookie, dependencies);
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  assert.ok(state);
  await completeGithubAccountConnection(state, "99", undefined, sessionCookie, dependencies);

  const diagnostics: unknown[][] = [];
  const originalInfo = console.info;
  console.info = (...values: unknown[]) => { if (values[0] === "[github-oauth]") diagnostics.push(values); };
  try {
    const redirect = await completeGithubAccountConnection(state, "99", "synthetic-code", sessionCookie, dependencies);
    assert.match(redirect, /github=error/);
  } finally {
    console.info = originalInfo;
  }
  const [, detail] = diagnostics.find(([, value]) =>
    (value as Record<string, unknown>)["redirectStage"] === "GITHUB_TOKEN_EXCHANGE_FAILED",
  ) ?? [];
  assert.ok(detail);
  assert.deepEqual(detail, {
    generatedInstallationPath: null,
    hasState: true,
    hasClientId: false,
    callbackRouteEntered: true,
    callbackQueryFieldPresence: { state: true, installationId: true, setupAction: false, code: true },
    redirectStage: "GITHUB_TOKEN_EXCHANGE_FAILED",
  });
  assert.equal(JSON.stringify(diagnostics).includes(state), false);
  assert.equal(JSON.stringify(diagnostics).includes(sessionCookie), false);
  assert.equal(JSON.stringify(diagnostics).includes("synthetic-code"), false);
});

test("OAuth update persists against the same owner used by refreshed status", async () => {
  configureGithub();
  const existingConnection = {
    githubUserId: "7",
    login: "old-login",
    installationId: 99,
    accessTokenEncrypted: "synthetic-old-encrypted-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    status: "connected",
    connectionGeneration: 3,
    repositories: [],
    sync: { status: "idle" },
  };
  const { dependencies, data } = makeDependencies(existingConnection);
  dependencies.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/app/installations/99")) return providerResponse({ id: 99 });
    if (url.endsWith("/login/oauth/access_token")) return providerResponse({ access_token: "synthetic-user-token" });
    if (url.endsWith("/user")) return providerResponse({ id: 7, login: "octocat" });
    if (url.includes("/user/installations")) return providerResponse({ installations: [{ id: 99 }] });
    if (url.endsWith("/app/installations/99/access_tokens")) {
      return providerResponse({ token: syntheticAccessToken, expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    }
    if (url.includes("/installation/repositories")) return providerResponse({ repositories: [] });
    throw new Error("Unexpected mocked GitHub request.");
  };
  const started = await beginGithubAccountConnection(ownerId, sessionCookie, dependencies);
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  assert.ok(state);
  await completeGithubAccountConnection(state, "99", undefined, sessionCookie, dependencies);
  const callback = await completeGithubAccountConnection(state, "99", "synthetic-code", sessionCookie, dependencies);

  assert.match(callback, /github=connected/);
  assert.equal(data.updateOwnerId, ownerId);
  assert.equal(data.updateInput?.["status"], "connected");
  assert.equal(data.connection?.["login"], "octocat");
  assert.equal((await getGithubAccountStatus(ownerId, dependencies)).status, "connected");
  assert.equal((await getGithubAccountStatus("64b000000000000000000002", dependencies)).status, "disconnected");
});

test("repository listing returns authorized repositories and selection persists only owned IDs and full names", async () => {
  configureGithub();
  const connection = {
    githubUserId: "7",
    login: "octocat",
    installationId: 99,
    accessTokenEncrypted: (await import("../src/services/github-crypto.js")).encryptGithubSecret(syntheticAccessToken, tokenEncryptionKey),
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    status: "connected",
    connectionGeneration: 4,
    repositories: [{ id: 42, fullName: "acme/project" }],
    sync: { status: "idle" },
  };
  const { dependencies, data } = makeDependencies(connection);
  dependencies.fetch = async (input) => {
    if (String(input).includes("/installation/repositories")) {
      return providerResponse({
        total_count: 2,
        repositories: [
          { id: 42, full_name: "acme/project", private: true, default_branch: "main" },
          { id: 43, full_name: "acme/other", private: false, default_branch: "trunk" },
        ],
      });
    }
    throw new Error(`Unexpected mocked GitHub request: ${String(input)}`);
  };

  const listed = await listGithubRepositoriesForUser(ownerId, dependencies);
  assert.deepEqual(listed.map((repository) => [repository.id, repository.selected]), [[42, true], [43, false]]);
  await assert.rejects(
    saveGithubRepositorySelection(ownerId, [999], dependencies),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "GITHUB_REPOSITORY_NOT_AUTHORIZED",
  );
  const selected = await saveGithubRepositorySelection(ownerId, [43], dependencies);
  assert.deepEqual(selected, [{ id: 43, fullName: "acme/other" }]);
  assert.deepEqual(data.updateInput?.["repositories"], [{ id: 43, fullName: "acme/other" }]);
  assert.equal(Object.keys((data.updateInput?.["repositories"] as Record<string, unknown>[])[0] ?? {}).sort().join(","), "fullName,id");
  assert.equal(data.updateInput?.["connectionGeneration"], 5);
});

test("repository selection rejects connections owned by another DevSignal account", async () => {
  configureGithub();
  const { dependencies } = makeDependencies();
  await assert.rejects(
    saveGithubRepositorySelection("64b000000000000000000002", [42], dependencies),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "GITHUB_NOT_CONNECTED",
  );
});

test("connection and repository API data never contain tokens or private keys", async () => {
  configureGithub();
  const connection = {
    githubUserId: "7",
    login: "octocat",
    installationId: 99,
    accessTokenEncrypted: (await import("../src/services/github-crypto.js")).encryptGithubSecret(syntheticAccessToken, tokenEncryptionKey),
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    status: "connected",
    connectionGeneration: 1,
    repositories: [],
    sync: { status: "idle" },
  };
  const { dependencies } = makeDependencies(connection);
  const status = await getGithubAccountStatus(ownerId, dependencies);
  dependencies.fetch = async () => providerResponse({
    repositories: [{ id: 42, full_name: "acme/project", private: true, default_branch: "main" }],
  });
  const repositories = await listGithubRepositoriesForUser(ownerId, dependencies);
  const logs: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...values: unknown[]) => logs.push(values.map(String).join(" "));
  console.error = (...values: unknown[]) => logs.push(values.map(String).join(" "));
  try {
    await getGithubAccountStatus(ownerId, dependencies);
    await listGithubRepositoriesForUser(ownerId, dependencies);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
  const payload = JSON.stringify({ status, repositories, logs });
  assert.equal(payload.includes(syntheticAccessToken), false);
  assert.equal(payload.includes(syntheticPrivateKey), false);
  assert.equal(payload.includes("accessTokenEncrypted"), false);
  assert.equal(payload.includes("privateKey"), false);
});
