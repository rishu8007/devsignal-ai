import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("LinkedIn encryption key is invalid.");
  return key;
}

export function encryptLinkedInSecret(value: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromBase64(keyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptLinkedInSecret(payload: string, keyBase64: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("LinkedIn encrypted value is malformed.");
  const [ivPart, tagPart, ciphertextPart] = parts;
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error("LinkedIn encrypted value is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", keyFromBase64(keyBase64), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64url")), decipher.final()]).toString("utf8");
}
