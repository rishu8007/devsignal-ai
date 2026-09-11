import assert from "node:assert/strict";
import { test } from "node:test";
import { AiServiceClient } from "../src/clients/ai-service.client.js";
import type { GenerationSource } from "../src/types/generation.js";

const source: GenerationSource = {
  topic: "Connecting an authenticated dashboard",
  notes: "I connected the dashboard form to an authenticated Express API and verified the flow.",
  primaryAudience: "Developers & engineers",
  contentType: "Build in public",
};

const validBody = {
  success: true,
  data: {
    model: "gpt-5-mini",
    variations: [
      { angle: "professional_impact", content: "p".repeat(100) },
      { angle: "technical_depth", content: "t".repeat(100) },
      { angle: "learning_story", content: "l".repeat(100) },
    ],
  },
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientWith(
  implementation: typeof fetch,
  requests: Array<{ input: RequestInfo | URL; init?: RequestInit }>,
  timeoutMs?: number,
): AiServiceClient {
  return new AiServiceClient(async (input, init) => {
    requests.push({ input, init });
    return implementation(input, init);
  }, timeoutMs, "test-internal-key-that-is-at-least-32-characters");
}

test("maps upstream authentication failure to AI_SERVICE_UNAVAILABLE", async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = clientWith(async () => response(401, {
    success: false,
    error: { code: "SERVICE_AUTHENTICATION_REQUIRED", message: "secret provider text" },
  }), requests);

  await assert.rejects(client.generate(source), (error: { statusCode: number; code: string; message: string }) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, "AI_SERVICE_UNAVAILABLE");
    assert.equal(error.message, "The AI service is unavailable");
    return true;
  });
});

test("maps an aborted request to AI_SERVICE_TIMEOUT", async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = clientWith(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    requests,
    10,
  );

  await assert.rejects(client.generate(source), (error: { statusCode: number; code: string }) => {
    assert.equal(error.statusCode, 504);
    assert.equal(error.code, "AI_SERVICE_TIMEOUT");
    return true;
  });
});

test("maps refusal and hides arbitrary upstream messages", async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = clientWith(async () => response(422, {
    success: false,
    error: {
      code: "AI_GENERATION_REFUSED",
      message: "provider secret refusal details",
    },
  }), requests);

  await assert.rejects(client.generate(source), (error: { statusCode: number; code: string; message: string }) => {
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, "AI_GENERATION_REFUSED");
    assert.equal(error.message, "The requested content could not be generated");
    assert.equal(error.message.includes("provider secret"), false);
    return true;
  });
});

test("maps malformed JSON and invalid success payloads to AI_INVALID_RESPONSE", async () => {
  const cases = [
    new Response("{not-json", { status: 200 }),
    response(200, { success: true, data: { model: "", variations: [] } }),
  ];

  for (const upstreamResponse of cases) {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = clientWith(async () => upstreamResponse, requests);

    await assert.rejects(
      client.generate(source),
      (error: { statusCode: number; code: string }) => {
        assert.equal(error.statusCode, 502);
        assert.equal(error.code, "AI_INVALID_RESPONSE");
        return true;
      },
    );
  }
});

test("uses redirect error when calling the AI service", async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = clientWith(async () => response(200, validBody), requests);

  await client.generate(source);

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.init?.redirect, "error");
});
