import assert from "node:assert/strict";
import test from "node:test";
import { requestLinkedInPostingConsent } from "../src/lib/api/linkedin-client";

test("LinkedIn posting consent request sends posting true", async () => {
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
      data: { authorizationUrl: "https://provider.invalid/authorization" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await requestLinkedInPostingConsent();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiBaseUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBaseUrl;
  }

  assert.equal(capturedUrl, "http://localhost:4000/api/v1/connections/linkedin/posting-consent");
  assert.equal(capturedInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    returnPath: "/dashboard?tab=connections",
    posting: true,
  });
});
