import assert from "node:assert/strict";
import test from "node:test";
import { previewGithubRepository, readGithubPreviewFile } from "../src/services/github-import.service.js";

const ownerId = "507f1f77bcf86cd799439011";
const commit = "a".repeat(40);
const blob = "b".repeat(40);

function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("rejects non-GitHub URLs before making an outbound request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response(500, {}); };
  try {
    await assert.rejects(
      previewGithubRepository(ownerId, { repositoryUrl: "https://example.com/owner/repo" }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "GITHUB_URL_INVALID",
    );
    await assert.rejects(
      previewGithubRepository(ownerId, { repositoryUrl: "https://user:pass@github.com/owner/repo" }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "GITHUB_URL_INVALID",
    );
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("pins the preview to the resolved commit and filters unsafe files", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    if (String(input).endsWith("/repos/acme/docs")) return response(200, { default_branch: "main" });
    if (String(input).includes("/git/ref/heads/main")) return response(200, { object: { sha: commit } });
    return response(200, {
      sha: commit,
      truncated: false,
      tree: [
        { type: "blob", path: "README.md", sha: blob, size: 24 },
        { type: "blob", path: ".github/workflow.md", sha: blob, size: 24 },
        { type: "blob", path: "node_modules/x.txt", sha: blob, size: 24 },
        { type: "commit", path: "submodule.txt", sha: commit, size: 24 },
        { type: "blob", path: "large.txt", sha: blob, size: 20_001 },
      ],
    });
  };
  try {
    const result = await previewGithubRepository(ownerId, { repositoryUrl: "https://github.com/acme/docs" });
    assert.equal(result.commitSha, commit);
    assert.deepEqual(result.files, [{ path: "README.md", size: 24 }]);
    assert.deepEqual(result.skipped, [{ path: "large.txt", reason: "File exceeds the 20,000-character source limit" }]);
    assert.ok(requests.some((url) => url.includes(`/git/trees/${commit}?recursive=1`)));
  } finally { globalThis.fetch = original; }
});

test("reads a selected file through the pinned blob endpoint", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/repos/acme/docs")) return response(200, { default_branch: "main" });
    if (url.includes("/git/ref/heads/main")) return response(200, { object: { sha: commit } });
    if (url.includes("/git/trees/")) return response(200, { truncated: false, tree: [{ type: "blob", path: "README.md", sha: blob, size: 24 }] });
    return response(200, { encoding: "base64", content: Buffer.from("A reviewed documentation note.").toString("base64") });
  };
  try {
    const preview = await previewGithubRepository(ownerId, { repositoryUrl: "https://github.com/acme/docs", branch: "main" });
    const file = await readGithubPreviewFile(ownerId, preview.previewToken, "README.md");
    assert.equal(file.commitSha, commit);
    assert.equal(file.blobSha, blob);
    assert.equal(file.content, "A reviewed documentation note.");
    await assert.rejects(
      readGithubPreviewFile("507f1f77bcf86cd799439012", preview.previewToken, "README.md"),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "GITHUB_PREVIEW_EXPIRED",
    );
  } finally { globalThis.fetch = original; }
});
