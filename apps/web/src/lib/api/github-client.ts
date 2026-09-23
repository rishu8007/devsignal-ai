import { request } from "./api-client";
export type GithubRepository = { id: number; fullName: string; private: boolean; defaultBranch: string; selected: boolean };
export type GithubActivity = { _id: string; repositoryFullName: string; kind: "commit" | "pull_request" | "release"; title: string; summary: string; url: string; occurredAt: string; authorLogin?: string | null; isPersonal: boolean; convertedSignalId?: string | null };
export type GithubStatus = { enabled: boolean; status: "not_configured" | "disconnected" | "connected" | "revoked"; identity?: { login: string; githubUserId: string }; repositories: GithubRepository[]; sync?: { status: string; lastSuccessAt: string | null; lastError: string | null; nextEligibleAt?: string | null } };
const ok = (value: unknown): value is { success: true; data: Record<string, unknown> } => Boolean(value && typeof value === "object" && (value as { success?: unknown }).success === true && "data" in value);
export function getGithubStatus() { return request("/connections/github/status", { method: "GET" }, ok).then((value) => value.data as GithubStatus); }
export function connectGithub() { return request("/connections/github/connect", { method: "POST", body: "{}" }, ok).then((value) => value.data as { authorizationUrl: string }); }
export function disconnectGithub() { return request("/connections/github", { method: "DELETE" }, ok); }
export function selectGithubRepositories(repositoryIds: number[]) { return request("/connections/github/repositories", { method: "PUT", body: JSON.stringify({ repositoryIds }) }, ok); }
export function syncGithub() { return request("/connections/github/sync", { method: "POST", body: "{}" }, ok).then((value) => value.data.activities as GithubActivity[]); }
export function listGithubActivities(kind?: GithubActivity["kind"], repositoryId?: number, page = 1) { const query = new URLSearchParams({ page: String(page) }); if (kind) query.set("kind", kind); if (repositoryId) query.set("repositoryId", String(repositoryId)); return request(`/connections/github/activities?${query}`, { method: "GET" }, ok).then((value) => value.data.activities as GithubActivity[]); }
export function convertGithubActivity(activityId: string) { return request(`/connections/github/activities/${activityId}/signal`, { method: "POST", body: "{}" }, ok).then((value) => value.data.signalId as string); }
