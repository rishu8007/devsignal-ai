import assert from "node:assert/strict";
import test from "node:test";
import { encryptLinkedInSecret, decryptLinkedInSecret } from "../src/services/linkedin-crypto.js";
import { HttpLinkedInOAuthClient } from "../src/clients/linkedin-oauth.client.js";

const key = Buffer.alloc(32, 7).toString("base64");

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
