import { env } from "../config/env.js";

export type LinkedInPublishResult =
  | { kind: "published"; providerPostId: string }
  | { kind: "rejected"; errorCode: string; errorMessage: string }
  | { kind: "uncertain"; errorCode: string; errorMessage: string };

export interface LinkedInPublishingClient {
  publishTextPost(accessToken: string, providerMemberId: string, text: string): Promise<LinkedInPublishResult>;
}

export class HttpLinkedInPublishingClient implements LinkedInPublishingClient {
  public constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  public async publishTextPost(accessToken: string, providerMemberId: string, text: string): Promise<LinkedInPublishResult> {
    let response: Response;
    try {
      response = await this.fetchImplementation("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
          "LinkedIn-Version": env.LINKEDIN_API_VERSION,
        },
        body: JSON.stringify({
          author: `urn:li:person:${providerMemberId}`,
          commentary: text,
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        }),
        redirect: "error",
      });
    } catch {
      return { kind: "uncertain", errorCode: "LINKEDIN_NETWORK_UNCERTAIN", errorMessage: "Check LinkedIn before taking further action." };
    }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        return { kind: "rejected", errorCode: "LINKEDIN_POST_REJECTED", errorMessage: "LinkedIn rejected this post." };
      }
      return { kind: "uncertain", errorCode: "LINKEDIN_PROVIDER_UNCERTAIN", errorMessage: "Check LinkedIn before taking further action." };
    }
    const headerId = response.headers.get("x-restli-id");
    if (headerId) return { kind: "published", providerPostId: headerId };
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "id" in body && typeof body.id === "string") {
        return { kind: "published", providerPostId: body.id };
      }
    } catch {
      // A successful response without a reliable identifier is uncertain.
    }
    return { kind: "uncertain", errorCode: "LINKEDIN_ID_UNAVAILABLE", errorMessage: "LinkedIn accepted a response without a reliable post identifier. Check LinkedIn before taking further action." };
  }
}

export const linkedinPublishingClient: LinkedInPublishingClient = new HttpLinkedInPublishingClient();
