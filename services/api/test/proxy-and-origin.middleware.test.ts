import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { configureProxyTrust } from "../src/config/proxy-trust.js";
import { sameOriginMiddleware } from "../src/middleware/same-origin.middleware.js";

const configuredOrigin = new URL(process.env.WEB_ORIGIN ?? "http://localhost:3000").origin;
const configuredCookieName = process.env.AUTH_COOKIE_NAME ?? "devsignal_access_token";

function requestAddress(
  trustedProxyHops: number,
  forwardedFor?: string,
): Promise<string> {
  const application = express();
  configureProxyTrust(application, trustedProxyHops);
  application.get("/address", (request, response) => response.send(request.ip));
  const server = application.listen(0);
  return new Promise((resolve, reject) => {
    server.once("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Test server did not expose a TCP address."));
        return;
      }
      const request = http.get(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/address",
          headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : undefined,
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => {
            server.close((error) => {
              if (error) reject(error);
              else resolve(body);
            });
          });
        },
      );
      request.once("error", reject);
    });
    server.once("error", reject);
  });
}

test("direct mode does not trust spoofed forwarded headers", async () => {
  assert.equal(await requestAddress(0, "198.51.100.10"), "::ffff:127.0.0.1");
});

test("one-hop deployment mode resolves the client address from the proxy", async () => {
  assert.equal(await requestAddress(1, "198.51.100.10"), "198.51.100.10");
});

test("extra forwarded addresses cannot replace the trusted proxy client address", async () => {
  assert.equal(
    await requestAddress(1, "203.0.113.99, 198.51.100.10"),
    "198.51.100.10",
  );
});

test("cookie-authenticated writes require the configured same-origin", async () => {
  const application = express();
  application.use(cookieParser());
  application.use(sameOriginMiddleware);
  application.post("/write", (_request, response) => response.sendStatus(204));
  application.use((
    error: { statusCode?: number },
    _request: unknown,
    response: { sendStatus: (status: number) => void },
    _next: unknown,
  ) =>
    response.sendStatus(error.statusCode ?? 500),
  );
  const server = application.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  assert.notEqual(address, null);
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test server did not expose a TCP address.");
  }

  const request = (origin?: string) =>
    new Promise<number>((resolve, reject) => {
      const headers: Record<string, string> = {
        Cookie: `${configuredCookieName}=test-token`,
      };
      if (origin) headers.Origin = origin;
      const client = http.request({
        host: "127.0.0.1",
        port: address.port,
        method: "POST",
        path: "/write",
        headers,
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      });
      client.once("error", reject);
      client.end();
    });

  assert.equal(await request(configuredOrigin), 204);
  assert.equal(await request("https://attacker.example"), 403);
  assert.equal(await request(), 403);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
