import { createHash, randomBytes, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  consumeLinkedInOauthState,
  createLinkedInConnection,
  createLinkedInOauthState,
  disconnectLinkedInConnection as disconnectStoredLinkedInConnection,
  findLinkedInConnection,
  findLinkedInConnectionByProviderMemberId,
  updateLinkedInConnection,
} from "../repositories/linkedin.repository.js";
import { decryptLinkedInSecret, encryptLinkedInSecret } from "./linkedin-crypto.js";
import { isLinkedInProviderOAuthError, linkedinOAuthClient, type LinkedInOAuthClient } from "../clients/linkedin-oauth.client.js";

const stateLifetimeMs = 10 * 60 * 1000;
const allowedReturnPath = "/dashboard?tab=connections";

export function parseLinkedInScopes(value: string | string[]): string[] {
  const source = Array.isArray(value) ? value.join(" ") : value;
  return source.split(/[,\s]+/).filter(Boolean);
}

export interface LinkedInConnectionRepository {
  consumeState: typeof consumeLinkedInOauthState;
  createState: typeof createLinkedInOauthState;
  findConnection: typeof findLinkedInConnection;
  findConnectionByProviderMemberId?: typeof findLinkedInConnectionByProviderMemberId;
  createConnection: typeof createLinkedInConnection;
  updateConnection: typeof updateLinkedInConnection;
  disconnectConnection: typeof disconnectStoredLinkedInConnection;
}

const defaultRepository: LinkedInConnectionRepository = {
  consumeState: consumeLinkedInOauthState,
  createState: createLinkedInOauthState,
  findConnection: findLinkedInConnection,
  findConnectionByProviderMemberId: findLinkedInConnectionByProviderMemberId,
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

function logCallbackFailure(stage: string, errorCode: string, error?: unknown): void {
  const diagnostic = error instanceof AppError ? error.diagnostic : undefined;
  const providerError = diagnostic?.providerError;
  console.error(JSON.stringify({
    event: "linkedin_oauth_callback_failed",
    stage,
    errorCode,
    ...(typeof diagnostic?.providerStatus === "number" ? { providerStatus: diagnostic.providerStatus } : {}),
    ...(typeof providerError === "string" && isLinkedInProviderOAuthError(providerError) ? { providerError } : {}),
  }));
}

function logCallbackStage(stage: string, details: Record<string, boolean | number | string>): void {
  console.debug(JSON.stringify({
    event: "linkedin_oauth_callback_stage",
    stage,
    ...details,
  }));
}

function redirectResult(redirect: string): string {
  try {
    return new URL(redirect).searchParams.get("linkedin") ?? "missing";
  } catch {
    return "invalid";
  }
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
  if (!env.LINKEDIN_ENABLED) return Promise.resolve({ enabled: false, publishingEnabled: false, schedulerEnabled: false, status: "not_configured" as const });
  return repository.findConnection(ownerId).then((connection) => ({
    enabled: true,
    publishingEnabled: env.LINKEDIN_PUBLISHING_ENABLED,
    schedulerEnabled: env.LINKEDIN_SCHEDULER_ENABLED,
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
  const scopes = parseLinkedInScopes(posting ? env.LINKEDIN_POSTING_SCOPES : env.LINKEDIN_SCOPES);
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
  });
  console.info(JSON.stringify({
    postingRequested: posting,
    requestedScopes: scopes,
    authorizationUrlScope: parseLinkedInScopes(query.get("scope") ?? ""),
  }));
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
  if (!state || !sessionCookie) {
    logCallbackFailure("state_validation", "LINKEDIN_CALLBACK_STATE_INVALID");
    return failurePath;
  }
  let consumed;
  try {
    consumed = await repository.consumeState(hash(state), hash(sessionCookie), new Date());
  } catch {
    logCallbackFailure("state_validation", "LINKEDIN_CALLBACK_STATE_LOOKUP_FAILED");
    return failurePath;
  }
  if (!consumed) {
    logCallbackFailure("state_validation", "LINKEDIN_CALLBACK_STATE_INVALID");
    return failurePath;
  }
  logCallbackStage("state_validation", { valid: true });
  const returnPath = consumed.returnPath;
  const resultPath = `${env.WEB_ORIGIN}${returnPath}`;
  if (providerError || !code || !env.LINKEDIN_TOKEN_ENCRYPTION_KEY) {
    logCallbackFailure("provider_consent", providerError ? "LINKEDIN_PROVIDER_DENIED" : "LINKEDIN_CALLBACK_CODE_MISSING");
    const redirect = `${resultPath}&linkedin=denied`;
    logCallbackStage("final_redirect", { result: redirectResult(redirect) });
    return redirect;
  }

  let verifier: string;
  try {
    verifier = decryptLinkedInSecret(consumed.codeVerifierEncrypted, env.LINKEDIN_TOKEN_ENCRYPTION_KEY);
  } catch {
    logCallbackFailure("verifier_decryption", "LINKEDIN_VERIFIER_DECRYPTION_FAILED");
    const redirect = `${resultPath}&linkedin=error`;
    logCallbackStage("final_redirect", { result: redirectResult(redirect) });
    return redirect;
  }
  let token;
  let identity;
  try {
    token = await client.exchangeCode(code, verifier);
  } catch (error) {
    logCallbackFailure("token_exchange", error instanceof AppError ? error.code : "LINKEDIN_TOKEN_EXCHANGE_FAILED", error);
    const redirect = `${resultPath}&linkedin=error`;
    logCallbackStage("final_redirect", { result: redirectResult(redirect) });
    return redirect;
  }
  logCallbackStage("token_exchange", { success: true });
  try {
    identity = await client.getMemberIdentity(token.access_token);
  } catch (error) {
    logCallbackFailure("userinfo", error instanceof AppError ? error.code : "LINKEDIN_IDENTITY_FAILED", error);
    const redirect = `${resultPath}&linkedin=error`;
    logCallbackStage("final_redirect", { result: redirectResult(redirect) });
    return redirect;
  }
  logCallbackStage("userinfo", { success: true });

  let existing;
  try {
    existing = await repository.findConnection(String(consumed.ownerId));
  } catch {
    logCallbackFailure("persistence_lookup", "LINKEDIN_CONNECTION_LOOKUP_FAILED");
    const redirect = `${resultPath}&linkedin=error`;
    logCallbackStage("final_redirect", { result: redirectResult(redirect) });
    return redirect;
  }
  if (existing && existing.connectionGeneration !== consumed.connectionGeneration) {
    const redirect = `${resultPath}&linkedin=stale`;
    logCallbackStage("final_redirect", { result: redirectResult(redirect) });
    return redirect;
  }
  if (existing && existing.providerMemberId !== identity.sub) {
    const redirect = `${resultPath}&linkedin=identity_mismatch`;
    logCallbackStage("final_redirect", { result: redirectResult(redirect) });
    return redirect;
  }

  const grantedScopes = parseLinkedInScopes(token.scope ?? consumed.requestedScopes);
  const postingCapability = grantedScopes.includes("w_member_social");
  console.info(JSON.stringify({
    requestedScopes: consumed.requestedScopes,
    tokenScopePresent: token.scope !== undefined,
    ...(token.scope !== undefined ? { tokenScopes: parseLinkedInScopes(token.scope) } : {}),
    finalGrantedScopes: grantedScopes,
    finalPostingCapability: postingCapability,
  }));
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
    capabilities: { identity: grantedScopes.includes("openid"), posting: postingCapability },
    status: "connected",
    connectionGeneration: (existing?.connectionGeneration ?? 0) + 1,
  };
  try {
    if (existing) await repository.updateConnection(String(consumed.ownerId), input);
    else {
      try {
        await repository.createConnection(input);
      } catch (error) {
        if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === 11000) {
          const correlationId = randomUUID();
          const conflicting = repository.findConnectionByProviderMemberId
            ? await repository.findConnectionByProviderMemberId(identity.sub)
            : null;
          console.error(JSON.stringify({
            event: "linkedin_oauth_identity_in_use",
            correlationId,
            currentOwnerId: String(consumed.ownerId),
            conflictingConnectionId: conflicting?._id ? String(conflicting._id) : null,
            conflictingOwnerId: conflicting?.ownerId ? String(conflicting.ownerId) : null,
          }));
          const redirect = `${resultPath}&linkedin=identity_in_use`;
          logCallbackStage("final_redirect", { result: redirectResult(redirect) });
          return redirect;
        }
        throw error;
      }
    }
  } catch {
    logCallbackFailure("persistence_write", "LINKEDIN_CONNECTION_SAVE_FAILED");
    const redirect = `${resultPath}&linkedin=error`;
    logCallbackStage("final_redirect", { result: redirectResult(redirect) });
    return redirect;
  }
  logCallbackStage("persistence_write", { success: true });
  const redirect = `${resultPath}&linkedin=connected`;
  logCallbackStage("final_redirect", { result: redirectResult(redirect) });
  return redirect;
}

export async function disconnectLinkedInConnection(ownerId: string, repository: LinkedInConnectionRepository = defaultRepository): Promise<void> {
  requireEnabled();
  await repository.disconnectConnection(ownerId);
}
