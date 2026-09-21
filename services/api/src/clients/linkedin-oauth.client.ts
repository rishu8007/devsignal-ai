import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
type MemberIdentity = { sub: string; name?: string; email?: string };

export interface LinkedInOAuthClient {
  exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse>;
  getMemberIdentity(accessToken: string): Promise<MemberIdentity>;
}

export class HttpLinkedInOAuthClient implements LinkedInOAuthClient {
  public constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  public async exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
    if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET || !env.LINKEDIN_REDIRECT_URI) {
      throw new AppError(503, "LINKEDIN_NOT_CONFIGURED", "LinkedIn is not configured.");
    }
    let response: Response;
    try {
      response = await this.fetchImplementation("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: env.LINKEDIN_REDIRECT_URI,
          client_id: env.LINKEDIN_CLIENT_ID,
          client_secret: env.LINKEDIN_CLIENT_SECRET,
          code_verifier: codeVerifier,
        }),
        redirect: "error",
      });
    } catch {
      throw new AppError(503, "LINKEDIN_UNAVAILABLE", "LinkedIn is unavailable.");
    }
    if (!response.ok) throw new AppError(502, "LINKEDIN_TOKEN_EXCHANGE_FAILED", "LinkedIn authorization could not be completed.");
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
    if (!response.ok) throw new AppError(502, "LINKEDIN_IDENTITY_FAILED", "LinkedIn identity could not be read.");
    const body = await readJson(response);
    if (!body || typeof body !== "object" || typeof body.sub !== "string") {
      throw new AppError(502, "LINKEDIN_INVALID_RESPONSE", "LinkedIn returned an invalid identity response.");
    }
    return body as MemberIdentity;
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
