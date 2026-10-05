import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../src/config/env.js";
import { getAuthCookieOptions } from "../src/config/auth-cookie.js";

test("HTTP local origins do not mark the auth cookie Secure in production-mode Compose", () => {
  const mutable = env as typeof env & Record<string, unknown>;
  const originalNodeEnv = mutable.NODE_ENV;
  const originalWebOrigin = mutable.WEB_ORIGIN;
  try {
    mutable.NODE_ENV = "production";
    mutable.WEB_ORIGIN = "http://localhost:3000";
    assert.equal(getAuthCookieOptions().secure, false);
  } finally {
    mutable.NODE_ENV = originalNodeEnv;
    mutable.WEB_ORIGIN = originalWebOrigin;
  }
});

test("HTTPS production origins keep the auth cookie Secure", () => {
  const mutable = env as typeof env & Record<string, unknown>;
  const originalNodeEnv = mutable.NODE_ENV;
  const originalWebOrigin = mutable.WEB_ORIGIN;
  try {
    mutable.NODE_ENV = "production";
    mutable.WEB_ORIGIN = "https://app.example.test";
    assert.equal(getAuthCookieOptions().secure, true);
  } finally {
    mutable.NODE_ENV = originalNodeEnv;
    mutable.WEB_ORIGIN = originalWebOrigin;
  }
});
