import { request } from "./api-client";

export interface LinkedInStatus {
  enabled: boolean;
  status: "not_configured" | "disconnected" | "connected" | "reconnect_required";
  connected?: boolean;
  identity?: { memberId: string; displayName: string | null; email: string | null };
  expiresAt?: string;
  grantedScopes?: string[];
  capabilities?: { identity: boolean; posting: boolean };
}

function isStatus(value: unknown): value is LinkedInStatus {
  return typeof value === "object" && value !== null && "enabled" in value && "status" in value;
}

export function getLinkedInStatus(): Promise<LinkedInStatus> {
  return request<{ success: true; data: LinkedInStatus }>("/connections/linkedin/status", { method: "GET" }, (value): value is { success: true; data: LinkedInStatus } => {
    if (typeof value !== "object" || value === null || !("success" in value) || value.success !== true) return false;
    return "data" in value && isStatus(value.data);
  }).then((value) => value.data);
}

export function connectLinkedIn(): Promise<{ authorizationUrl: string }> {
  return request("/connections/linkedin/connect", {
    method: "POST",
    body: JSON.stringify({ returnPath: "/dashboard?tab=connections" }),
  }, (value): value is { data: { authorizationUrl: string } } => {
    return typeof value === "object" && value !== null && "success" in value && value.success === true &&
      "data" in value && typeof value.data === "object" && value.data !== null &&
      "authorizationUrl" in value.data && typeof value.data.authorizationUrl === "string";
  }).then((value) => value.data);
}

export function disconnectLinkedIn(): Promise<void> {
  return request("/connections/linkedin", { method: "DELETE" }, (value): value is { success: true } =>
    typeof value === "object" && value !== null && "success" in value && value.success === true,
  ).then(() => undefined);
}
