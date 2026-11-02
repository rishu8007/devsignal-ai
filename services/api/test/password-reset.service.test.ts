import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import bcrypt from "bcrypt";
import { Types } from "mongoose";
import { requestPasswordReset, resetPassword } from "../src/services/auth.service.js";
import { forgotPasswordSchema, resetPasswordSchema } from "../src/validation/auth.validation.js";
import type { PasswordResetMailer } from "../src/services/password-reset-mailer.service.js";

const now = new Date("2030-01-01T00:00:00.000Z");
const userId = new Types.ObjectId("507f1f77bcf86cd799439011");

function hash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function createRepository(accountExists = true) {
  let activeTokenHash: string | null = null;
  let expiresAt: Date | null = null;
  let passwordHash = "original-password-hash";
  let sessionVersion = 0;
  return {
    repository: {
      findUserForPasswordReset: async () => accountExists ? { _id: userId, email: "person@example.com" } : null,
      issuePasswordReset: async (_id: string, tokenHash: string, expiry: Date) => {
        activeTokenHash = tokenHash;
        expiresAt = expiry;
      },
      consumePasswordReset: async (tokenHash: string, nextPasswordHash: string, at: Date) => {
        if (activeTokenHash !== tokenHash || !expiresAt || expiresAt <= at) return null;
        activeTokenHash = null;
        expiresAt = null;
        passwordHash = nextPasswordHash;
        sessionVersion += 1;
        return { passwordHash, sessionVersion };
      },
    },
    state: {
      get activeTokenHash() { return activeTokenHash; },
      get passwordHash() { return passwordHash; },
      get sessionVersion() { return sessionVersion; },
    },
  };
}

function recordingMailer(): { mailer: PasswordResetMailer; urls: string[] } {
  const urls: string[] = [];
  return {
    mailer: { sendPasswordReset: async ({ resetUrl }) => { urls.push(resetUrl); } },
    urls,
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test("forgot-password validates strict input and uses the same non-enumerating service outcome", async () => {
  assert.equal(forgotPasswordSchema.safeParse({ email: "person@example.com", extra: true }).success, false);
  const known = createRepository(true);
  const unknown = createRepository(false);
  const knownMail = recordingMailer();
  const unknownMail = recordingMailer();

  await requestPasswordReset({ email: "person@example.com" }, knownMail.mailer, now, known.repository);
  await requestPasswordReset({ email: "unknown@example.com" }, unknownMail.mailer, now, unknown.repository);
  await flushAsyncWork();

  assert.equal(knownMail.urls.length, 1);
  assert.equal(unknownMail.urls.length, 0);
  assert.ok(known.state.activeTokenHash);
  assert.equal(unknown.state.activeTokenHash, null);
});

test("reset tokens are valid once, expire explicitly, and supersede earlier tokens", async () => {
  const store = createRepository();
  const mail = recordingMailer();
  await requestPasswordReset({ email: "person@example.com" }, mail.mailer, now, store.repository);
  await flushAsyncWork();
  const firstToken = new URL(mail.urls[0]).searchParams.get("token");
  assert.ok(firstToken);

  await requestPasswordReset({ email: "person@example.com" }, mail.mailer, now, store.repository);
  await flushAsyncWork();
  const secondToken = new URL(mail.urls[1]).searchParams.get("token");
  assert.ok(secondToken);

  await assert.rejects(
    resetPassword({ token: firstToken, password: "new password 123" }, now, store.repository),
    { code: "PASSWORD_RESET_TOKEN_INVALID" },
  );
  await resetPassword({ token: secondToken, password: "new password 123" }, now, store.repository);
  await assert.rejects(
    resetPassword({ token: secondToken, password: "new password 123" }, now, store.repository),
    { code: "PASSWORD_RESET_TOKEN_INVALID" },
  );
  assert.equal(await bcrypt.compare("new password 123", store.state.passwordHash), true);
  assert.equal(store.state.sessionVersion, 1);

  const expired = createRepository();
  await assert.rejects(
    resetPassword({ token: "a".repeat(43), password: "new password 123" }, now, expired.repository),
    { code: "PASSWORD_RESET_TOKEN_INVALID" },
  );
});

test("concurrent reset attempts allow exactly one password update", async () => {
  const store = createRepository();
  const token = "a".repeat(43);
  await store.repository.issuePasswordReset(userId.toString(), hash(token), new Date(now.getTime() + 1_000));
  const attempts = await Promise.allSettled([
    resetPassword({ token, password: "new password 123" }, now, store.repository),
    resetPassword({ token, password: "new password 123" }, now, store.repository),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(store.state.sessionVersion, 1);
});

test("reset-password validation enforces policy and strict input", () => {
  assert.equal(resetPasswordSchema.safeParse({ token: "a".repeat(43), password: "short" }).success, false);
  assert.equal(resetPasswordSchema.safeParse({ token: "a".repeat(43), password: "é".repeat(37) }).success, false);
  assert.equal(resetPasswordSchema.safeParse({ token: "a".repeat(43), password: "new password 123", extra: true }).success, false);
});
