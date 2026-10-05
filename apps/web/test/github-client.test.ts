import assert from "node:assert/strict";
import test from "node:test";
import { listGithubRepositories } from "../src/lib/api/github-client";

test("GitHub repository listing requests the authenticated repository endpoint", async () => {
  const originalApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:4000/api/v1";
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({
      success: true,
      data: {
        repositories: [{
          id: 42,
          fullName: "acme/project",
          private: true,
          defaultBranch: "main",
          selected: false,
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const repositories = await listGithubRepositories();
    assert.equal(repositories[0]?.id, 42);
    assert.equal(repositories[0]?.selected, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiBaseUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBaseUrl;
  }

  assert.equal(capturedUrl, "http://localhost:4000/api/v1/connections/github/repositories");
  assert.equal(capturedInit?.method, "GET");
  assert.equal(capturedInit?.credentials, "include");
});
