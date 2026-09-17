import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiBaseUrl } from "../src/lib/api/api-client";

test("resolves a same-origin API base path against the browser origin", () => {
  assert.equal(
    resolveApiBaseUrl("/api/v1", "https://notes.example.test"),
    "https://notes.example.test/api/v1",
  );
});

test("preserves absolute API base URLs for direct development", () => {
  assert.equal(
    resolveApiBaseUrl("http://localhost:4000/api/v1", "https://notes.example.test"),
    "http://localhost:4000/api/v1",
  );
});
