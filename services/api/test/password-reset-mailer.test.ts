import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../src/config/env.js";
import { passwordResetMailer } from "../src/services/password-reset-mailer.service.js";

test("password-reset mailer reports missing SMTP configuration without contacting a server", async () => {
  const originalHost = env.SMTP_HOST;
  const originalFrom = env.SMTP_FROM;
  env.SMTP_HOST = undefined;
  env.SMTP_FROM = undefined;
  try {
    await assert.rejects(
      passwordResetMailer.sendPasswordReset({
        recipient: "user@example.test",
        resetUrl: "https://example.test/reset-password?token=redacted",
        expiresAt: new Date("2030-01-01T00:15:00.000Z"),
      }),
      /SMTP is not configured/,
    );
  } finally {
    env.SMTP_HOST = originalHost;
    env.SMTP_FROM = originalFrom;
  }
});
