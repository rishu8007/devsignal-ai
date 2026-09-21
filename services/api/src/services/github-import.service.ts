import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../errors/app-error.js";
import {
  createGithubKnowledgeSource,
  findGithubKnowledgeSource,
  findKnowledgeSourceForIndexing,
  updateGithubKnowledgeSourceIfVersionAndLeaseAvailable,
} from "../repositories/knowledge-source.repository.js";
import type { KnowledgeSourceDocument } from "../models/knowledge-source.model.js";
import type { GithubImportInput, GithubPreviewInput, GithubRefreshInput } from "../validation/github-import.validation.js";
import { Types } from "mongoose";
import { toPublicKnowledgeSourceDto } from "./knowledge-source.service.js";

const API_ORIGIN = "https://api.github.com";
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_FILE_BYTES = 20_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const previews = new Map<string, { ownerId: string; repositoryUrl: string; branch: string; commitSha: string; files: Map<string, { blobSha: string; size: number }>; expiresAt: number }>();
type GithubProvenance = {
  repositoryUrl: string; branch: string; path: string; commitSha: string; blobSha: string; importedContentHash: string;
};

function provenance(value: KnowledgeSourceDocument["github"]): GithubProvenance {
  if (!value?.repositoryUrl || !value.branch || !value.path || !value.commitSha || !value.blobSha || !value.importedContentHash) {
    fail(500, "SOURCE_PROVENANCE_INVALID", "The imported source provenance is invalid");
  }
  return value as GithubProvenance;
}

type GithubResponse = { status: number; headers: Headers; body: string };

function fail(status: number, code: string, message: string): never {
  throw new AppError(status, code, message);
}

function parseRepositoryUrl(value: string): { owner: string; repository: string; canonical: string } {
  let url: URL;
  try { url = new URL(value); } catch { fail(400, "GITHUB_URL_INVALID", "Use a public https://github.com/owner/repository URL"); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) {
    fail(400, "GITHUB_URL_INVALID", "Only public GitHub HTTPS repository URLs are supported");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const owner = parts[0];
  const repository = parts[1];
  if (!owner || !repository || parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
    fail(400, "GITHUB_URL_INVALID", "Use a public https://github.com/owner/repository URL");
  }
  return { owner, repository: repository.replace(/\.git$/, ""), canonical: `https://github.com/${owner}/${repository.replace(/\.git$/, "")}` };
}

async function githubGet(path: string, timeoutMs = 10_000): Promise<GithubResponse> {
  if (!path.startsWith("/repos/") || path.includes("://") || path.includes("..")) {
    fail(500, "GITHUB_REQUEST_INVALID", "Invalid GitHub API request");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_ORIGIN}${path}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "DevSignal-AI" },
      redirect: "error",
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) fail(502, "GITHUB_RESPONSE_TOO_LARGE", "GitHub response was too large");
        chunks.push(next.value);
      }
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
    return { status: response.status, headers: response.headers, body };
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail(502, "GITHUB_UNAVAILABLE", "GitHub could not be reached");
  } finally {
    clearTimeout(timeout);
  }
}

function json(response: GithubResponse): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(response.body);
    if (typeof value !== "object" || value === null) throw new Error();
    return value as Record<string, unknown>;
  } catch { fail(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid response"); }
}

function githubFailure(response: GithubResponse): never {
  if (response.status === 404) fail(404, "GITHUB_REPOSITORY_NOT_FOUND", "The public repository or branch was not found");
  if (response.status === 403 || response.status === 429) fail(429, "GITHUB_RATE_LIMITED", "GitHub rate limit reached; try again later");
  fail(502, "GITHUB_ERROR", "GitHub could not provide the requested repository data");
}

function eligible(path: string): boolean {
  const parts = path.split("/");
  return !parts.some((part) => part.startsWith(".") || ["node_modules", "dist", "build", "coverage", "vendor", ".git"].includes(part)) &&
    /\.(md|markdown|txt)$/i.test(path);
}

function requirePreview(ownerId: string, token: string) {
  const preview = previews.get(token);
  if (!preview || preview.ownerId !== ownerId || preview.expiresAt < Date.now()) {
    previews.delete(token);
    fail(410, "GITHUB_PREVIEW_EXPIRED", "The GitHub preview expired; start a new preview");
  }
  return preview;
}

async function resolveCommit(owner: string, repository: string, branch?: string): Promise<{ branch: string; sha: string }> {
  const repoResponse = await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`);
  if (!repoResponse || repoResponse.status !== 200) githubFailure(repoResponse);
  const repo = json(repoResponse);
  const selectedBranch = branch?.trim() || (typeof repo.default_branch === "string" ? repo.default_branch : "");
  if (!selectedBranch || !/^[A-Za-z0-9._/-]+$/.test(selectedBranch) || selectedBranch.includes("..")) {
    fail(400, "GITHUB_BRANCH_INVALID", "Branch name is invalid");
  }
  const refResponse = await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${selectedBranch.split("/").map(encodeURIComponent).join("/")}`);
  if (refResponse.status !== 200) githubFailure(refResponse);
  const ref = json(refResponse);
  const object = ref.object;
  const sha = typeof object === "object" && object !== null && "sha" in object && typeof object.sha === "string" ? object.sha : "";
  if (!/^[a-f0-9]{40}$/i.test(sha)) fail(502, "GITHUB_INVALID_RESPONSE", "GitHub returned no commit SHA");
  return { branch: selectedBranch, sha };
}

export async function previewGithubRepository(ownerId: string, input: GithubPreviewInput) {
  if (!Types.ObjectId.isValid(ownerId)) fail(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  const parsed = parseRepositoryUrl(input.repositoryUrl);
  const commit = await resolveCommit(parsed.owner, parsed.repository, input.branch);
  const treeResponse = await githubGet(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/git/trees/${commit.sha}?recursive=1`);
  if (treeResponse.status !== 200) githubFailure(treeResponse);
  const tree = json(treeResponse);
  if (tree.truncated === true) fail(502, "GITHUB_TREE_TRUNCATED", "GitHub returned an incomplete repository listing");
  const entries = Array.isArray(tree.tree) ? tree.tree : [];
  const files = new Map<string, { blobSha: string; size: number }>();
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    if (item.type !== "blob" || typeof item.path !== "string" || typeof item.sha !== "string" || !eligible(item.path)) continue;
    const size = typeof item.size === "number" ? item.size : MAX_FILE_BYTES + 1;
    if (size <= MAX_FILE_BYTES) files.set(item.path, { blobSha: item.sha, size });
    else skipped.push({ path: item.path, reason: "File exceeds the 20,000-character source limit" });
  }
  const token = randomUUID();
  previews.set(token, { ownerId, repositoryUrl: parsed.canonical, branch: commit.branch, commitSha: commit.sha, files, expiresAt: Date.now() + PREVIEW_TTL_MS });
  return { previewToken: token, repositoryUrl: parsed.canonical, branch: commit.branch, commitSha: commit.sha, files: [...files].map(([path, item]) => ({ path, size: item.size })), skipped };
}

export async function readGithubPreviewFile(ownerId: string, token: string, path: string) {
  const preview = requirePreview(ownerId, token);
  const file = preview.files.get(path);
  if (!file) fail(400, "GITHUB_FILE_UNAVAILABLE", "The selected file is no longer available in this preview");
  const parsed = parseRepositoryUrl(preview.repositoryUrl);
  const response = await githubGet(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/git/blobs/${encodeURIComponent(file.blobSha)}`);
  if (response.status !== 200) githubFailure(response);
  const payload = json(response);
  if (payload.encoding !== "base64" || typeof payload.content !== "string") fail(502, "GITHUB_INVALID_RESPONSE", "GitHub returned an invalid file response");
  let content: string;
  try { content = Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8"); } catch { fail(502, "GITHUB_ENCODING_INVALID", "GitHub file encoding was invalid"); }
  if (content.length === 0) fail(422, "GITHUB_FILE_EMPTY", "The selected file is empty");
  if (content.trim().length < 10 || content.trim().length > 20_000 || content.includes("\uFFFD")) fail(422, "GITHUB_FILE_UNSUPPORTED", "The selected file is empty, invalid UTF-8, or outside the note size limit");
  return { path, content, blobSha: file.blobSha, commitSha: preview.commitSha, branch: preview.branch, repositoryUrl: preview.repositoryUrl };
}

export async function importGithubFile(ownerId: string, input: GithubImportInput) {
  const file = await readGithubPreviewFile(ownerId, input.previewToken, input.path);
  const existing = await findGithubKnowledgeSource(ownerId, file.repositoryUrl, file.path);
  const hash = createHash("sha256").update(file.content).digest("hex");
  if (existing) {
    if (existing.github?.commitSha === file.commitSha && existing.github.importedContentHash === hash) return { source: toPublicKnowledgeSourceDto(existing), unchanged: true };
    fail(409, "GITHUB_SOURCE_EXISTS", "This file is already imported; use refresh to review upstream changes");
  }
  const source = await createGithubKnowledgeSource(ownerId, {
    title: input.title,
    content: file.content,
    github: { repositoryUrl: file.repositoryUrl, branch: file.branch, path: file.path, commitSha: file.commitSha, blobSha: file.blobSha, importedContentHash: hash },
  });
  return { source: toPublicKnowledgeSourceDto(source), unchanged: false };
}

export async function checkGithubRefresh(ownerId: string, sourceId: string) {
  const current = await findKnowledgeSourceForIndexing(ownerId, sourceId);
  if (!current?.github) fail(404, "SOURCE_NOT_FOUND", "Knowledge source not found");
  const currentGithub = provenance(current.github);
  const parsed = parseRepositoryUrl(currentGithub.repositoryUrl);
  const commit = await resolveCommit(parsed.owner, parsed.repository, currentGithub.branch);
  const treeResponse = await githubGet(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/git/trees/${commit.sha}?recursive=1`);
  if (treeResponse.status !== 200) githubFailure(treeResponse);
  const tree = json(treeResponse);
  if (tree.truncated === true) fail(502, "GITHUB_TREE_TRUNCATED", "GitHub returned an incomplete repository listing");
  const entry = Array.isArray(tree.tree) ? tree.tree.find((item) => typeof item === "object" && item !== null && (item as Record<string, unknown>).path === currentGithub.path) as Record<string, unknown> | undefined : undefined;
  if (!entry || entry.type !== "blob" || typeof entry.sha !== "string") return { source: current, changed: true, disappeared: true };
  const incoming = await readGithubPreviewFile(ownerId, await createRefreshPreview(ownerId, currentGithub.repositoryUrl, currentGithub.branch, commit.sha, currentGithub.path, entry.sha), currentGithub.path);
  return { source: current, changed: incoming.blobSha !== currentGithub.blobSha || createHash("sha256").update(incoming.content).digest("hex") !== currentGithub.importedContentHash, disappeared: false, incoming };
}

async function createRefreshPreview(ownerId: string, repositoryUrl: string, branch: string, commitSha: string, path: string, blobSha: string) {
  const token = randomUUID();
  previews.set(token, { ownerId, repositoryUrl, branch, commitSha, files: new Map([[path, { blobSha, size: MAX_FILE_BYTES }]]), expiresAt: Date.now() + PREVIEW_TTL_MS });
  return token;
}

export async function refreshGithubSource(ownerId: string, sourceId: string, input: GithubRefreshInput) {
  const checked = await checkGithubRefresh(ownerId, sourceId);
  if (checked.disappeared) fail(409, "GITHUB_FILE_DISAPPEARED", "The upstream file no longer exists; your local note was retained");
  if (!checked.changed) return { source: toPublicKnowledgeSourceDto(checked.source), unchanged: true };
  if (!checked.incoming) fail(502, "GITHUB_INVALID_RESPONSE", "GitHub returned no incoming content");
  const incoming = checked.incoming;
  const currentHash = createHash("sha256").update(checked.source.content).digest("hex");
  if (!input.acknowledgeLocalEdits && currentHash !== currentGithubHash(checked.source.github)) fail(409, "GITHUB_LOCAL_EDITS_REQUIRE_ACKNOWLEDGMENT", "Review the current and incoming content, then acknowledge replacing local edits");
  const currentGithub = provenance(checked.source.github);
  const github = { ...currentGithub, commitSha: incoming.commitSha, blobSha: incoming.blobSha, branch: incoming.branch, importedContentHash: createHash("sha256").update(incoming.content).digest("hex") };
  const updated = await updateGithubKnowledgeSourceIfVersionAndLeaseAvailable(ownerId, sourceId, { title: checked.source.title, content: incoming.content, expectedContentVersion: input.expectedContentVersion, github }, new Date());
  if (!updated) fail(409, "SOURCE_VERSION_CONFLICT", "Source changed or indexing is in progress; reload before refreshing");
  return { source: toPublicKnowledgeSourceDto(updated), unchanged: false };
}

function currentGithubHash(value: KnowledgeSourceDocument["github"]): string {
  return provenance(value).importedContentHash;
}
