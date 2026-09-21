import { request } from "./api-client";

export interface LinkedInPublication {
  id: string;
  signalId: string;
  generationId: string;
  variationId: string;
  text: string;
  draftContentHash: string;
  account: { memberId: string; displayName: string | null };
  visibility: "PUBLIC";
  status: "pending" | "published" | "rejected" | "uncertain";
  providerPostId: string | null;
  postUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  previewExpiresAt: string;
  createdAt: string;
  dispatchedAt: string | null;
  publishedAt: string | null;
}

function isPublication(value: unknown): value is LinkedInPublication {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" &&
    "status" in value && (value.status === "pending" || value.status === "published" || value.status === "rejected" || value.status === "uncertain");
}

export function createLinkedInPreview(signalId: string, variationId: string): Promise<LinkedInPublication> {
  return request("/publications/linkedin/preview", {
    method: "POST",
    body: JSON.stringify({ signalId, variationId }),
  }, (value): value is { success: true; data: { preview: LinkedInPublication } } =>
    typeof value === "object" && value !== null && "success" in value && value.success === true &&
    "data" in value && typeof value.data === "object" && value.data !== null &&
    "preview" in value.data && isPublication(value.data.preview),
  ).then((value) => value.data.preview);
}

export function confirmLinkedInPublication(previewId: string): Promise<LinkedInPublication> {
  return request("/publications/linkedin/confirm", {
    method: "POST",
    body: JSON.stringify({ previewId }),
  }, (value): value is { success: true; data: { publication: LinkedInPublication } } =>
    typeof value === "object" && value !== null && "success" in value && value.success === true &&
    "data" in value && typeof value.data === "object" && value.data !== null &&
    "publication" in value.data && isPublication(value.data.publication),
  ).then((value) => value.data.publication);
}

export function listLinkedInPublications(): Promise<LinkedInPublication[]> {
  return request("/publications/linkedin", { method: "GET" }, (value): value is { success: true; data: { publications: LinkedInPublication[] } } =>
    typeof value === "object" && value !== null && "success" in value && value.success === true &&
    "data" in value && typeof value.data === "object" && value.data !== null &&
    "publications" in value.data && Array.isArray(value.data.publications) &&
    value.data.publications.every(isPublication),
  ).then((value) => value.data.publications);
}
