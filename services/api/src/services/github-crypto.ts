import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(value: string) {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) throw new Error("GitHub encryption key is invalid.");
  return decoded;
}
export function encryptGithubSecret(value: string, keyBase64: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyBase64), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}
export function decryptGithubSecret(payload: string, keyBase64: string) {
  const [iv, tag, encrypted] = payload.split(".");
  if (!iv || !tag || !encrypted) throw new Error("GitHub encrypted value is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", key(keyBase64), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
