import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Types } from "mongoose";
import { encryptLinkedInSecret, decryptLinkedInSecret } from "../src/services/linkedin-crypto.js";
import { HttpLinkedInOAuthClient } from "../src/clients/linkedin-oauth.client.js";
import { env } from "../src/config/env.js";
import {
  beginLinkedInConnection,
  completeLinkedInConnection,
  getLinkedInStatus,
  parseLinkedInScopes,
  type LinkedInConnectionRepository,
} from "../src/services/linkedin-connection.service.js";

const key = Buffer.alloc(32, 7).toString("base64");

function enableLinkedIn() {
  const mutable = env as typeof env & Record<string, unknown>;
  mutable.LINKEDIN_ENABLED = true;
  mutable.LINKEDIN_CLIENT_ID = "client";
  mutable.LINKEDIN_CLIENT_SECRET = "secret";
  mutable.LINKEDIN_REDIRECT_URI = "http://localhost/callback";
  mutable.LINKEDIN_TOKEN_ENCRYPTION_KEY = key;
  mutable.LINKEDIN_PUBLISHING_ENABLED = false;
  mutable.LINKEDIN_SCHEDULER_ENABLED = false;
}

async function completeConsentWithScope(tokenScope?: string, posting = true) {
  enableLinkedIn();
  let storedState: Record<string, unknown> | undefined;
  let savedConnection: Record<string, unknown> | undefined;
  const logs: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: Parameters<typeof console.info>) => {
    logs.push(args.map(String).join(" "));
  };
  const repository: LinkedInConnectionRepository = {
    createState: async (input) => {
      storedState = input as unknown as Record<string, unknown>;
      return input as never;
    },
    consumeState: async () => storedState as never,
    findConnection: async () => savedConnection as never,
    createConnection: async (input) => {
      savedConnection = input as unknown as Record<string, unknown>;
      return input as never;
    },
    updateConnection: async () => null,
    disconnectConnection: async () => null as never,
  };

  try {
    const ownerId = new Types.ObjectId().toString();
    const authorization = await beginLinkedInConnection(
      ownerId,
      "synthetic-session",
      undefined,
      posting,
      repository,
    );
    const authorizationUrl = new URL(authorization.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");
    assert.ok(state);

    const client = {
      exchangeCode: async () => ({
        access_token: "synthetic-access-token",
        expires_in: 3600,
        ...(tokenScope === undefined ? {} : { scope: tokenScope }),
      }),
      getMemberIdentity: async () => ({ sub: "synthetic-member" }),
    };
    const redirect = await completeLinkedInConnection(
      state,
      "synthetic-authorization-code",
      undefined,
      "synthetic-session",
      client,
      repository,
    );
    const status = await getLinkedInStatus(ownerId, repository);

    return {
      requestedScope: authorizationUrl.searchParams.get("scope"),
      requestedScopes: storedState?.["requestedScopes"],
      redirect,
      capabilities: savedConnection?.["capabilities"],
      status,
      logs: logs.map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  } finally {
    console.info = originalInfo;
  }
}

test("LinkedIn token encryption round trips and rejects tampering", () => {
  const encrypted = encryptLinkedInSecret("access-token", key);
  assert.equal(decryptLinkedInSecret(encrypted, key), "access-token");
  const parts = encrypted.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  assert.throws(() => decryptLinkedInSecret(parts.join("."), key));
});

test("LinkedIn scopes parse comma-separated, mixed-delimiter, and identity-only values", () => {
  const scopes = parseLinkedInScopes("email,openid,profile,w_member_social");
  assert.deepEqual(scopes, ["email", "openid", "profile", "w_member_social"]);
  assert.deepEqual(parseLinkedInScopes(" email,\topenid profile,\nw_member_social "), [
    "email",
    "openid",
    "profile",
    "w_member_social",
  ]);
  assert.deepEqual(parseLinkedInScopes(["openid", "profile", "email"]), ["openid", "profile", "email"]);
  assert.deepEqual(parseLinkedInScopes("openid,profile,email"), ["openid", "profile", "email"]);
});

test("LinkedIn identity responses are validated without contacting a real provider", async () => {
  const client = new HttpLinkedInOAuthClient(async () =>
    new Response(JSON.stringify({ name: "not an identity" }), { status: 200 }),
  );
  await assert.rejects(client.getMemberIdentity("mock-token"), /invalid identity response/i);
});

test("LinkedIn callback sends configured credentials through the real client with form encoding", async () => {
  enableLinkedIn();
  const redirectUri = "https://devsignal.example.test/callback?source=oauth&mode=local";
  const clientId = "synthetic-linkedin-client-42";
  const clientSecret = "synthetic secret +&=%/?";
  const encryptionKey = Buffer.alloc(32, 29).toString("base64");
  const mutable = env as typeof env & Record<string, unknown>;
  mutable.LINKEDIN_REDIRECT_URI = redirectUri;
  mutable.LINKEDIN_CLIENT_ID = clientId;
  mutable.LINKEDIN_CLIENT_SECRET = clientSecret;
  mutable.LINKEDIN_TOKEN_ENCRYPTION_KEY = encryptionKey;
  mutable.LINKEDIN_OAUTH_DIAGNOSTICS_ENABLED = true;
  process.env.LINKEDIN_CLIENT_ID = clientId;
  process.env.LINKEDIN_CLIENT_SECRET = clientSecret;

  let storedState: Record<string, unknown> | undefined;
  let savedConnection: Record<string, unknown> | undefined;
  const repository: LinkedInConnectionRepository = {
    createState: async (input) => {
      storedState = input;
      return input as never;
    },
    consumeState: async () => storedState as never,
    findConnection: async () => null,
    createConnection: async (input) => {
      savedConnection = input;
      return input as never;
    },
    updateConnection: async () => null,
    disconnectConnection: async () => null as never,
  };
  const authorization = await beginLinkedInConnection("owner", "session", undefined, false, repository);
  const authorizationUrl = new URL(authorization.authorizationUrl);
  const state = authorizationUrl.searchParams.get("state");
  const verifierEncrypted = storedState?.["codeVerifierEncrypted"];
  const verifier = decryptLinkedInSecret(verifierEncrypted as string, encryptionKey);
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(authorizationUrl.searchParams.has("code_challenge"), false);
  assert.equal(authorizationUrl.searchParams.has("code_challenge_method"), false);

  let requestCount = 0;
  let tokenUrl = "";
  let tokenRequest: RequestInit | undefined;
  const diagnosticLogs: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  const originalProcessClientId = process.env.LINKEDIN_CLIENT_ID;
  const originalProcessClientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  console.info = (...args: Parameters<typeof console.info>) => {
    diagnosticLogs.push(args.map(String).join(" "));
  };
  const client = new HttpLinkedInOAuthClient(async (input, init) => {
    requestCount += 1;
    if (String(input) === "https://www.linkedin.com/oauth/v2/accessToken") {
      tokenUrl = String(input);
      tokenRequest = init;
      return new Response(JSON.stringify({
        access_token: "synthetic-access-token",
        expires_in: 3600,
        scope: "openid profile email",
      }), { status: 200 });
    }
    assert.equal(String(input), "https://api.linkedin.com/v2/userinfo");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access-token");
    return new Response(JSON.stringify({ sub: "synthetic-member", name: "Synthetic Member" }), { status: 200 });
  });
  console.error = () => undefined;
  try {
    assert.ok(state);
    const redirect = await completeLinkedInConnection(
      state,
      "synthetic-authorization-code",
      undefined,
      "session",
      client,
      repository,
    );
    assert.match(redirect, /linkedin=connected/);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
    if (originalProcessClientId === undefined) delete process.env.LINKEDIN_CLIENT_ID;
    else process.env.LINKEDIN_CLIENT_ID = originalProcessClientId;
    if (originalProcessClientSecret === undefined) delete process.env.LINKEDIN_CLIENT_SECRET;
    else process.env.LINKEDIN_CLIENT_SECRET = originalProcessClientSecret;
  }

  assert.equal(requestCount, 2);
  assert.equal(tokenUrl, "https://www.linkedin.com/oauth/v2/accessToken");
  assert.equal(tokenRequest?.method, "POST");
  assert.equal(new Headers(tokenRequest?.headers).get("Content-Type"), "application/x-www-form-urlencoded");
  assert.equal(new Headers(tokenRequest?.headers).has("authorization"), false);
  assert.ok(tokenRequest?.body instanceof URLSearchParams);
  const form = tokenRequest.body;
  assert.deepEqual(Object.fromEntries(form.entries()), {
    grant_type: "authorization_code",
    code: "synthetic-authorization-code",
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  assert.equal(
    decryptLinkedInSecret(savedConnection?.["accessTokenEncrypted"] as string, encryptionKey),
    "synthetic-access-token",
  );
  assert.deepEqual(savedConnection?.["capabilities"], { identity: true, posting: false });
  assert.equal(diagnosticLogs.length, 2);
  const diagnostic = diagnosticLogs
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((entry) => "requestClientIdPresent" in entry);
  assert.ok(diagnostic);
  assert.deepEqual(diagnostic, {
    requestClientIdPresent: true,
    requestClientSecretPresent: true,
    requestClientIdMatchesProcessEnv: true,
    requestClientSecretMatchesProcessEnv: true,
    requestRedirectUriMatchesConfigured: true,
    authorizationHeaderPresent: false,
  });
  assert.ok(Object.values(diagnostic).every((value) => typeof value === "boolean"));
});

test("LinkedIn token diagnostics stay silent when the opt-in flag is false", async () => {
  enableLinkedIn();
  const mutable = env as typeof env & Record<string, unknown>;
  mutable.LINKEDIN_OAUTH_DIAGNOSTICS_ENABLED = false;
  const logs: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: Parameters<typeof console.info>) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await new HttpLinkedInOAuthClient(async () =>
      new Response(JSON.stringify({ access_token: "synthetic-token", expires_in: 60 }), { status: 200 }),
    ).exchangeCode("synthetic-code", "synthetic-verifier");
  } finally {
    console.info = originalInfo;
  }
  assert.deepEqual(logs, []);
});

test("LinkedIn callback diagnostics allowlist OAuth errors and redact request and response secrets", async () => {
  enableLinkedIn();
  const clientId = "client+id&=%/";
  const clientSecret = "secret+with&special=%chars";
  const authorizationCode = "code+with&special=%chars";
  const verifier = "verifier+with&special=%chars";
  const mutable = env as typeof env & Record<string, unknown>;
  mutable.LINKEDIN_CLIENT_ID = clientId;
  mutable.LINKEDIN_CLIENT_SECRET = clientSecret;
  const state = {
    ownerId: new Types.ObjectId(),
    returnPath: "/dashboard?tab=connections",
    connectionGeneration: 0,
    codeVerifierEncrypted: encryptLinkedInSecret(verifier, key),
  } as never;
  const repository: LinkedInConnectionRepository = {
    createState: async () => null as never,
    consumeState: async () => state,
    findConnection: async () => null,
    createConnection: async () => null as never,
    updateConnection: async () => null,
    disconnectConnection: async () => null as never,
  };
  let capturedInit: RequestInit | undefined;
  let requestCount = 0;
  const providerResponses = [
    new Response(JSON.stringify({
      error: "invalid_client_secret",
      error_description: `sensitive ${clientSecret} ${authorizationCode} ${verifier}`,
    }), { status: 401 }),
    new Response(JSON.stringify({
      error: `unknown-${clientSecret}`,
      error_description: `sensitive ${authorizationCode} ${verifier}`,
    }), { status: 401 }),
    new Response("not-json", { status: 401 }),
  ];
  const client = new HttpLinkedInOAuthClient(async (_input, init) => {
    requestCount += 1;
    capturedInit = init;
    return providerResponses.shift() ?? new Response(null, { status: 500 });
  });
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    for (let index = 0; index < 3; index += 1) {
      const redirect = await completeLinkedInConnection("synthetic-state", authorizationCode, undefined, "synthetic-session", client, repository);
      assert.match(redirect, /linkedin=error/);
    }
  } finally {
    console.error = originalError;
  }

  assert.equal(requestCount, 3);
  assert.ok(capturedInit?.body instanceof URLSearchParams);
  const form = capturedInit.body;
  assert.equal(form.get("client_id"), clientId);
  assert.equal(form.get("client_secret"), clientSecret);
  assert.equal(form.get("code"), authorizationCode);
  assert.equal(form.has("code_verifier"), false);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(logs.length, 3);
  const diagnostic = JSON.parse(logs[0] ?? "{}") as Record<string, unknown>;
  assert.deepEqual(diagnostic, {
    event: "linkedin_oauth_callback_failed",
    stage: "token_exchange",
    errorCode: "LINKEDIN_TOKEN_EXCHANGE_FAILED",
    providerStatus: 401,
    providerError: "invalid_client_secret",
  });
  const serializedDiagnostic = JSON.stringify(diagnostic);
  for (const sensitiveValue of [clientId, clientSecret, authorizationCode, verifier, "sensitive"]) {
    assert.equal(serializedDiagnostic.includes(sensitiveValue), false);
  }
  for (const [index, expectedProviderError] of ["invalid_client_secret", "unknown", "unknown"].entries()) {
    const item = JSON.parse(logs[index] ?? "{}") as Record<string, unknown>;
    assert.equal(item.providerError, expectedProviderError);
    assert.equal(item.providerStatus, 401);
    assert.equal(item.stage, "token_exchange");
  }
});

test("OAuth state binds session and late callbacks after disconnect are fenced", async () => {
  enableLinkedIn();
  const state = {
    ownerId: new Types.ObjectId(),
    returnPath: "/dashboard?tab=connections",
    connectionGeneration: 2,
    codeVerifierEncrypted: encryptLinkedInSecret("verifier", key),
  } as never;
  let consumed = true;
  let created = 0;
  const repository: LinkedInConnectionRepository = {
    createState: async () => state,
    consumeState: async () => {
      if (!consumed) return null;
      consumed = false;
      return state;
    },
    findConnection: async () => ({ connectionGeneration: 3 }) as never,
    createConnection: async () => {
      created += 1;
      return state;
    },
    updateConnection: async () => state,
    disconnectConnection: async () => null as never,
  };
  const started = await beginLinkedInConnection("owner", "session", undefined, true, repository);
  const url = new URL(started.authorizationUrl);
  assert.equal(url.searchParams.get("scope"), "openid profile email w_member_social");
  const client = {
    exchangeCode: async () => ({ access_token: "token", expires_in: 60 }),
    getMemberIdentity: async () => ({ sub: "member" }),
  };
  const stale = await completeLinkedInConnection("state", "code", undefined, "session", client, repository);
  assert.match(stale, /linkedin=stale/);
  assert.equal(created, 0);
  const replay = await completeLinkedInConnection("state", "code", undefined, "session", client, repository);
  assert.match(replay, /linkedin=error/);
});

test("posting consent requests w_member_social and uses requested scopes when token scope is omitted", async () => {
  const result = await completeConsentWithScope();

  assert.equal(result.requestedScope, "openid profile email w_member_social");
  assert.deepEqual(result.requestedScopes, ["openid", "profile", "email", "w_member_social"]);
  assert.match(result.redirect, /linkedin=connected/);
  assert.deepEqual(result.capabilities, { identity: true, posting: true });
  assert.deepEqual(result.status.capabilities, { identity: true, posting: true });
  assert.equal(result.status.publishingEnabled, false);
  assert.equal(result.status.schedulerEnabled, false);
  assert.deepEqual(result.logs[0], {
    postingRequested: true,
    requestedScopes: ["openid", "profile", "email", "w_member_social"],
    authorizationUrlScope: ["openid", "profile", "email", "w_member_social"],
  });
  assert.deepEqual(result.logs[1], {
    requestedScopes: ["openid", "profile", "email", "w_member_social"],
    tokenScopePresent: false,
    finalGrantedScopes: ["openid", "profile", "email", "w_member_social"],
    finalPostingCapability: true,
  });
});

test("explicit comma-separated token scopes including posting grant posting capability", async () => {
  const result = await completeConsentWithScope("email,openid,profile,w_member_social");

  assert.equal(result.requestedScope, "openid profile email w_member_social");
  assert.match(result.redirect, /linkedin=connected/);
  assert.deepEqual(result.capabilities, { identity: true, posting: true });
  assert.deepEqual(result.status.capabilities, { identity: true, posting: true });
  assert.deepEqual(result.logs[1], {
    requestedScopes: ["openid", "profile", "email", "w_member_social"],
    tokenScopePresent: true,
    tokenScopes: ["email", "openid", "profile", "w_member_social"],
    finalGrantedScopes: ["email", "openid", "profile", "w_member_social"],
    finalPostingCapability: true,
  });
});

test("explicit token scopes excluding posting do not grant posting capability", async () => {
  const result = await completeConsentWithScope("openid,profile,email");

  assert.deepEqual(result.capabilities, { identity: true, posting: false });
  assert.deepEqual(result.status.capabilities, { identity: true, posting: false });
});

test("identity-only consent without response scope remains without posting capability", async () => {
  const result = await completeConsentWithScope(undefined, false);

  assert.equal(result.requestedScope, "openid profile email");
  assert.deepEqual(result.capabilities, { identity: true, posting: false });
  assert.deepEqual(result.status.capabilities, { identity: true, posting: false });
  assert.equal(result.status.publishingEnabled, false);
  assert.equal(result.status.schedulerEnabled, false);
});

test("posting consent overwrites existing connection capabilities and status returns the update", async () => {
  enableLinkedIn();
  const ownerId = new Types.ObjectId().toString();
  const existingConnection: Record<string, unknown> = {
    ownerId: new Types.ObjectId(ownerId),
    providerMemberId: "synthetic-member",
    displayName: "Synthetic Member",
    email: null,
    accessTokenEncrypted: "old-encrypted-token",
    refreshTokenEncrypted: null,
    expiresAt: new Date(Date.now() + 60_000),
    grantedScopes: ["openid", "profile", "email"],
    capabilities: { identity: true, posting: false },
    status: "connected",
    connectionGeneration: 3,
  };
  let savedConnection = existingConnection;
  let updateCount = 0;
  let state: Record<string, unknown> | undefined;
  const repository: LinkedInConnectionRepository = {
    createState: async (input) => {
      state = input as unknown as Record<string, unknown>;
      return input as never;
    },
    consumeState: async () => state as never,
    findConnection: async () => savedConnection as never,
    createConnection: async () => {
      throw new Error("Existing connection should be updated, not recreated.");
    },
    updateConnection: async (_id, update) => {
      updateCount += 1;
      savedConnection = { ...savedConnection, ...update } as Record<string, unknown>;
      return savedConnection as never;
    },
    disconnectConnection: async () => null as never,
  };
  const authorization = await beginLinkedInConnection(
    ownerId,
    "synthetic-session",
    undefined,
    true,
    repository,
  );
  const stateValue = new URL(authorization.authorizationUrl).searchParams.get("state");
  assert.ok(stateValue);

  const originalInfo = console.info;
  console.info = () => undefined;
  let redirect: string;
  try {
    redirect = await completeLinkedInConnection(
      stateValue,
      "synthetic-authorization-code",
      undefined,
      "synthetic-session",
      {
        exchangeCode: async () => ({
          access_token: "synthetic-access-token",
          expires_in: 3600,
          scope: "openid profile email w_member_social",
        }),
        getMemberIdentity: async () => ({ sub: "synthetic-member" }),
      },
      repository,
    );
  } finally {
    console.info = originalInfo;
  }

  assert.match(redirect, /linkedin=connected/);
  assert.equal(updateCount, 1);
  assert.deepEqual(savedConnection["capabilities"], { identity: true, posting: true });
  const status = await getLinkedInStatus(ownerId, repository);
  assert.deepEqual(status.capabilities, { identity: true, posting: true });
});

test("OAuth session mismatch is rejected without exchanging the code", async () => {
  enableLinkedIn();
  let exchanges = 0;
  const repository: LinkedInConnectionRepository = {
    createState: async () => null as never,
    consumeState: async () => null,
    findConnection: async () => null,
    createConnection: async () => null as never,
    updateConnection: async () => null,
    disconnectConnection: async () => null as never,
  };
  const result = await completeLinkedInConnection("state", "code", undefined, "wrong-session", {
    exchangeCode: async () => {
      exchanges += 1;
      return { access_token: "token", expires_in: 60 };
    },
    getMemberIdentity: async () => ({ sub: "member" }),
  }, repository);
  assert.match(result, /linkedin=error/);
  assert.equal(exchanges, 0);
});
