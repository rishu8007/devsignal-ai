import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  consumeLinkedInOauthState,
  createLinkedInConnection,
  createLinkedInOauthState,
  disconnectLinkedInConnection as disconnectStoredLinkedInConnection,
  findLinkedInConnection,
  updateLinkedInConnection,
} from "../repositories/linkedin.repository.js";
import { decryptLinkedInSecret, encryptLinkedInSecret } from "./linkedin-crypto.js";
import { linkedinOAuthClient, type LinkedInOAuthClient } from "../clients/linkedin-oauth.client.js";

const stateLifetimeMs = 10 * 60 * 1000;
const allowedReturnPath = "/dashboard?tab=connections";

export interface LinkedInConnectionRepository {
  consumeState: typeof consumeLinkedInOauthState;
  createState: typeof createLinkedInOauthState;
  findConnection: typeof findLinkedInConnection;
  createConnection: typeof createLinkedInConnection;
  updateConnection: typeof updateLinkedInConnection;
  disconnectConnection: typeof disconnectStoredLinkedInConnection;
}

const defaultRepository: LinkedInConnectionRepository = {
  consumeState: consumeLinkedInOauthState,
  createState: createLinkedInOauthState,
  findConnection: findLinkedInConnection,
  createConnection: createLinkedInConnection,
  updateConnection: updateLinkedInConnection,
  disconnectConnection: disconnectStoredLinkedInConnection,
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function randomValue(): string {
  return randomBytes(32).toString("base64url");
}

function requireEnabled(): void {
  if (!env.LINKEDIN_ENABLED) throw new AppError(503, "LINKEDIN_NOT_CONFIGURED", "LinkedIn is not configured.");
}

function safeReturnPath(value: unknown): string {
  if (value === undefined) return allowedReturnPath;
  if (value !== allowedReturnPath) throw new AppError(400, "INVALID_RETURN_PATH", "The return path is not allowed.");
  return value;
}

function publicConnection(connection: Awaited<ReturnType<typeof findLinkedInConnection>>) {
  if (!connection) return { connected: false, status: "disconnected" as const };
  return {
    connected: connection.status === "connected" && connection.accessTokenEncrypted !== null,
    status: connection.status,
    identity: { memberId: connection.providerMemberId, displayName: connection.displayName, email: connection.email },
    expiresAt: connection.expiresAt,
    grantedScopes: connection.grantedScopes,
    capabilities: connection.capabilities,
  };
}

export function getLinkedInStatus(ownerId: string, repository: LinkedInConnectionRepository = defaultRepository) {
  if (!env.LINKEDIN_ENABLED) return Promise.resolve({ enabled: false, publishingEnabled: false, status: "not_configured" as const });
  return repository.findConnection(ownerId).then((connection) => ({
    enabled: true,
    publishingEnabled: env.LINKEDIN_PUBLISHING_ENABLED,
    ...publicConnection(connection),
    status: connection && connection.expiresAt <= new Date() ? "reconnect_required" : publicConnection(connection).status,
  }));
}

export async function beginLinkedInConnection(ownerId: string, sessionCookie: string, returnPath: unknown, posting = false, repository: LinkedInConnectionRepository = defaultRepository): Promise<{ authorizationUrl: string }> {
  requireEnabled();
  if (!sessionCookie) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_REDIRECT_URI || !env.LINKEDIN_TOKEN_ENCRYPTION_KEY) {
    throw new AppError(503, "LINKEDIN_NOT_CONFIGURED", "LinkedIn is not configured.");
  }
  const state = randomValue();
  const verifier = randomValue();
  const challenge = hash(verifier);
  const scopes = (posting ? env.LINKEDIN_POSTING_SCOPES : env.LINKEDIN_SCOPES).split(/\s+/).filter(Boolean);
  await repository.createState({
    stateHash: hash(state),
    ownerId,
    sessionHash: hash(sessionCookie),
    codeVerifierEncrypted: encryptLinkedInSecret(verifier, env.LINKEDIN_TOKEN_ENCRYPTION_KEY),
    returnPath: safeReturnPath(returnPath),
    connectionGeneration: (await repository.findConnection(ownerId))?.connectionGeneration ?? 0,
    requestedScopes: scopes,
    expiresAt: new Date(Date.now() + stateLifetimeMs),
  });
  const query = new URLSearchParams({
    response_type: "code",
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri: env.LINKEDIN_REDIRECT_URI,
    state,
    scope: scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { authorizationUrl: `https://www.linkedin.com/oauth/v2/authorization?${query.toString()}` };
}

export async function completeLinkedInConnection(
  state: string | undefined,
  code: string | undefined,
  providerError: string | undefined,
  sessionCookie: string | undefined,
  client: LinkedInOAuthClient = linkedinOAuthClient,
  repository: LinkedInConnectionRepository = defaultRepository,
): Promise<string> {
  const failurePath = `${env.WEB_ORIGIN}${allowedReturnPath}&linkedin=error`;
  if (!state || !sessionCookie) return failurePath;
  const consumed = await repository.consumeState(hash(state), hash(sessionCookie), new Date());
  if (!consumed) return failurePath;
  const returnPath = consumed.returnPath;
  const resultPath = `${env.WEB_ORIGIN}${returnPath}`;
  if (providerError || !code || !env.LINKEDIN_TOKEN_ENCRYPTION_KEY) return `${resultPath}&linkedin=denied`;

  const verifier = decryptLinkedInSecret(consumed.codeVerifierEncrypted, env.LINKEDIN_TOKEN_ENCRYPTION_KEY);
  let token;
  let identity;
  try {
    token = await client.exchangeCode(code, verifier);
    identity = await client.getMemberIdentity(token.access_token);
  } catch (error) {
    if (error instanceof AppError) return `${resultPath}&linkedin=error`;
    throw error;
  }
  const existing = await repository.findConnection(String(consumed.ownerId));
  if (existing && existing.connectionGeneration !== consumed.connectionGeneration) {
    return `${resultPath}&linkedin=stale`;
  }
  if (existing && existing.providerMemberId !== identity.sub) {
    return `${resultPath}&linkedin=identity_mismatch`;
  }

  const grantedScopes = (token.scope ?? env.LINKEDIN_SCOPES).split(/\s+/).filter(Boolean);
  const input = {
    ownerId: consumed.ownerId,
    providerMemberId: identity.sub,
    displayName: identity.name ?? null,
    email: identity.email ?? null,
    accessTokenEncrypted: encryptLinkedInSecret(token.access_token, env.LINKEDIN_TOKEN_ENCRYPTION_KEY),
    refreshTokenEncrypted: token.refresh_token
      ? encryptLinkedInSecret(token.refresh_token, env.LINKEDIN_TOKEN_ENCRYPTION_KEY)
      : null,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    grantedScopes,
    capabilities: { identity: grantedScopes.includes("openid"), posting: grantedScopes.includes("w_member_social") },
    status: "connected",
    connectionGeneration: (existing?.connectionGeneration ?? 0) + 1,
  };
  if (existing)   await repository.updateConnection(String(consumed.ownerId), input);
  else {
    try {
      await repository.createConnection(input);
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === 11000) {
        return `${resultPath}&linkedin=identity_in_use`;
      }
      throw error;
    }
  }
  return `${resultPath}&linkedin=connected`;
}

export async function disconnectLinkedInConnection(ownerId: string, repository: LinkedInConnectionRepository = defaultRepository): Promise<void> {
  requireEnabled();
  await repository.disconnectConnection(ownerId);
}
