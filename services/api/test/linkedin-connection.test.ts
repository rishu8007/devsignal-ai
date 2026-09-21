import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { encryptLinkedInSecret, decryptLinkedInSecret } from "../src/services/linkedin-crypto.js";
import { HttpLinkedInOAuthClient } from "../src/clients/linkedin-oauth.client.js";
import { env } from "../src/config/env.js";
import {
  beginLinkedInConnection,
  completeLinkedInConnection,
  type LinkedInConnectionRepository,
} from "../src/services/linkedin-connection.service.js";

const key = Buffer.alloc(32, 7).toString("base64");

function enableLinkedIn() {
  const mutable = env as typeof env & Record<string, unknown>;
  mutable.LINKEDIN_ENABLED = true;
  mutable.LINKEDIN_CLIENT_ID = "client";
  mutable.LINKEDIN_CLIENT_SECRET = "secret";
  mutable.LINKEDIN_REDIRECT_URI = "http://localhost/callback";
  mutable.LINKEDIN_TOKEN_ENCRYPTION_KEY = key;
}

test("LinkedIn token encryption round trips and rejects tampering", () => {
  const encrypted = encryptLinkedInSecret("access-token", key);
  assert.equal(decryptLinkedInSecret(encrypted, key), "access-token");
  const parts = encrypted.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  assert.throws(() => decryptLinkedInSecret(parts.join("."), key));
});

test("LinkedIn identity responses are validated without contacting a real provider", async () => {
  const client = new HttpLinkedInOAuthClient(async () =>
    new Response(JSON.stringify({ name: "not an identity" }), { status: 200 }),
  );
  await assert.rejects(client.getMemberIdentity("mock-token"), /invalid identity response/i);
});

test("OAuth state binds session and late callbacks after disconnect are fenced", async () => {
  enableLinkedIn();
  const state = {
    ownerId: new Types.ObjectId(),
    returnPath: "/dashboard?tab=connections",
    connectionGeneration: 2,
    codeVerifierEncrypted: encryptLinkedInSecret("verifier", key),
  } as never;
  let consumed = true;
  let created = 0;
  const repository: LinkedInConnectionRepository = {
    createState: async () => state,
    consumeState: async () => {
      if (!consumed) return null;
      consumed = false;
      return state;
    },
    findConnection: async () => ({ connectionGeneration: 3 }) as never,
    createConnection: async () => {
      created += 1;
      return state;
    },
    updateConnection: async () => state,
    disconnectConnection: async () => null as never,
  };
  const started = await beginLinkedInConnection("owner", "session", undefined, true, repository);
  const url = new URL(started.authorizationUrl);
  assert.equal(url.searchParams.get("scope"), "openid profile email w_member_social");
  const client = {
    exchangeCode: async () => ({ access_token: "token", expires_in: 60 }),
    getMemberIdentity: async () => ({ sub: "member" }),
  };
  const stale = await completeLinkedInConnection("state", "code", undefined, "session", client, repository);
  assert.match(stale, /linkedin=stale/);
  assert.equal(created, 0);
  const replay = await completeLinkedInConnection("state", "code", undefined, "session", client, repository);
  assert.match(replay, /linkedin=error/);
});

test("OAuth session mismatch is rejected without exchanging the code", async () => {
  enableLinkedIn();
  let exchanges = 0;
  const repository: LinkedInConnectionRepository = {
    createState: async () => null as never,
    consumeState: async () => null,
    findConnection: async () => null,
    createConnection: async () => null as never,
    updateConnection: async () => null,
    disconnectConnection: async () => null as never,
  };
  const result = await completeLinkedInConnection("state", "code", undefined, "wrong-session", {
    exchangeCode: async () => {
      exchanges += 1;
      return { access_token: "token", expires_in: 60 };
    },
    getMemberIdentity: async () => ({ sub: "member" }),
  }, repository);
  assert.match(result, /linkedin=error/);
  assert.equal(exchanges, 0);
});
