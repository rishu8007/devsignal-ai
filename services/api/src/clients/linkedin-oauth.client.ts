import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
type MemberIdentity = { sub: string; name?: string; email?: string };
export type LinkedInProviderOAuthError =
  | "invalid_client"
  | "invalid_client_id"
  | "invalid_client_secret"
  | "invalid_grant"
  | "invalid_request"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "unknown";

const providerOAuthErrors = new Set<Exclude<LinkedInProviderOAuthError, "unknown">>([
  "invalid_client",
  "invalid_client_id",
  "invalid_client_secret",
  "invalid_grant",
  "invalid_request",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
]);

export function isLinkedInProviderOAuthError(value: string): value is LinkedInProviderOAuthError {
  return value === "unknown" || providerOAuthErrors.has(value as Exclude<LinkedInProviderOAuthError, "unknown">);
}

export class LinkedInProviderError extends AppError {
  public constructor(providerStatus: number, code: string, message: string, providerError: LinkedInProviderOAuthError) {
    super(502, code, message, true, undefined, { providerStatus, providerError });
  }
}

export interface LinkedInOAuthClient {
  exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse>;
  getMemberIdentity(accessToken: string): Promise<MemberIdentity>;
}

export class HttpLinkedInOAuthClient implements LinkedInOAuthClient {
  public constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  public async exchangeCode(code: string, _codeVerifier: string): Promise<TokenResponse> {
    if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET || !env.LINKEDIN_REDIRECT_URI) {
      throw new AppError(503, "LINKEDIN_NOT_CONFIGURED", "LinkedIn is not configured.");
    }
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.LINKEDIN_REDIRECT_URI,
      client_id: env.LINKEDIN_CLIENT_ID,
      client_secret: env.LINKEDIN_CLIENT_SECRET,
    });
    const tokenRequest: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "error",
    };
    if (env.LINKEDIN_OAUTH_DIAGNOSTICS_ENABLED) {
      const requestClientId = form.get("client_id");
      const requestClientSecret = form.get("client_secret");
      console.info(JSON.stringify({
        requestClientIdPresent: typeof requestClientId === "string" && requestClientId.length > 0,
        requestClientSecretPresent: typeof requestClientSecret === "string" && requestClientSecret.length > 0,
        requestClientIdMatchesProcessEnv: requestClientId === process.env.LINKEDIN_CLIENT_ID,
        requestClientSecretMatchesProcessEnv: requestClientSecret === process.env.LINKEDIN_CLIENT_SECRET,
        requestRedirectUriMatchesConfigured: form.get("redirect_uri") === env.LINKEDIN_REDIRECT_URI,
        authorizationHeaderPresent: new Headers(tokenRequest.headers).has("authorization"),
      }));
    }
    let response: Response;
    try {
      response = await this.fetchImplementation("https://www.linkedin.com/oauth/v2/accessToken", tokenRequest);
    } catch {
      throw new AppError(503, "LINKEDIN_UNAVAILABLE", "LinkedIn is unavailable.");
    }
    if (!response.ok) {
      const providerError = await readProviderOAuthError(response);
      throw new LinkedInProviderError(
        response.status,
        "LINKEDIN_TOKEN_EXCHANGE_FAILED",
        "LinkedIn authorization could not be completed.",
        providerError,
      );
    }
    const body = await readJson(response);
    if (!body || typeof body !== "object" || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new AppError(502, "LINKEDIN_INVALID_RESPONSE", "LinkedIn returned an invalid authorization response.");
    }
    return body as TokenResponse;
  }

  public async getMemberIdentity(accessToken: string): Promise<MemberIdentity> {
    let response: Response;
    try {
      response = await this.fetchImplementation("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "error",
      });
    } catch {
      throw new AppError(503, "LINKEDIN_UNAVAILABLE", "LinkedIn is unavailable.");
    }
    if (!response.ok) {
      const providerError = await readProviderOAuthError(response);
      throw new LinkedInProviderError(
        response.status,
        "LINKEDIN_IDENTITY_FAILED",
        "LinkedIn identity could not be read.",
        providerError,
      );
    }
    const body = await readJson(response);
    if (!body || typeof body !== "object" || typeof body.sub !== "string") {
      throw new AppError(502, "LINKEDIN_INVALID_RESPONSE", "LinkedIn returned an invalid identity response.");
    }
    return body as MemberIdentity;
  }
}

async function readProviderOAuthError(response: Response): Promise<LinkedInProviderOAuthError> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || !("error" in payload)) return "unknown";
    const value = payload.error;
    return typeof value === "string" && isLinkedInProviderOAuthError(value)
      ? value as LinkedInProviderOAuthError
      : "unknown";
  } catch {
    return "unknown";
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new AppError(502, "LINKEDIN_INVALID_RESPONSE", "LinkedIn returned an invalid response.");
  }
}

export const linkedinOAuthClient: LinkedInOAuthClient = new HttpLinkedInOAuthClient();
