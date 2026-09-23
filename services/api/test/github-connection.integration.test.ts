import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test, { after, before, beforeEach } from "node:test";
import mongoose, { Types } from "mongoose";

const uri = process.env.MONGODB_INTEGRATION_URI ?? "";

if (!uri) {
  test("GitHub service integration requires MONGODB_INTEGRATION_URI", { skip: true }, () => {});
} else {
  process.env.MONGODB_URI = uri;
  process.env.NODE_ENV = "test";
  process.env.JWT_ACCESS_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.GITHUB_ENABLED = "true";
  process.env.GITHUB_APP_CLIENT_ID = "client";
  process.env.GITHUB_APP_CLIENT_SECRET = "client-secret";
  process.env.GITHUB_APP_ID = "123";
  process.env.GITHUB_APP_SLUG = "devsignal-test";
  process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.GITHUB_REDIRECT_URI = "http://localhost:4000/api/v1/github/callback";
  process.env.GITHUB_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GITHUB_SYNC_MAX_PAGES_PER_PASS = "1";
  process.env.GITHUB_INITIAL_HISTORY_DAYS = "3650";

  const { GithubActivityModel } = await import("../src/models/github-activity.model.js");
  const { GithubConnectionModel } = await import("../src/models/github-connection.model.js");
  const { ensureGithubIndexes } = await import("../src/repositories/github.repository.js");
  const { encryptGithubSecret } = await import("../src/services/github-crypto.js");
  const { beginGithubConnection, completeGithubConnection, syncGithubActivities } = await import("../src/services/github-connection.service.js");

  const owner = new Types.ObjectId();
  const repository = { id: 42, fullName: "acme/project", private: true, defaultBranch: "main", selected: true };
  const token = encryptGithubSecret("installation-token", process.env.GITHUB_TOKEN_ENCRYPTION_KEY);

  before(async () => {
    await mongoose.connect(uri);
    await ensureGithubIndexes();
  });

  beforeEach(async () => {
    await GithubActivityModel.deleteMany({});
    await GithubConnectionModel.deleteMany({});
  });

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  function response(body: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(body), { status: 200, ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  }

  function connection(expiresAt = new Date(Date.now() + 3600_000)) {
    return GithubConnectionModel.create({
      ownerId: owner,
      githubUserId: "7",
      login: "octocat",
      installationId: 99,
      accessTokenEncrypted: token,
      accessTokenExpiresAt: expiresAt,
      status: "connected",
      connectionGeneration: 1,
      repositories: [repository],
    });
  }

  test("syncs paginated activity, resumes progress, and refreshes an expired installation token", async () => {
    await connection(new Date(Date.now() - 60_000));
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/app/installations/99/access_tokens")) return response({ token: "refreshed-token", expires_at: new Date(Date.now() + 3600_000).toISOString() });
      if (url.includes("/commits?") && url.includes("page=1")) {
        return response([{ sha: "c1", author: { login: "octocat" }, commit: { author: { date: "2026-01-03T00:00:00Z" }, message: "first commit" }, html_url: "https://github.com/acme/project/commit/c1" }], { headers: { link: '<https://api.github.com/repos/acme/project/commits?page=2>; rel="next"' } });
      }
      if (url.includes("/commits?") && url.includes("page=2")) return response([{ sha: "c2", author: { login: "other" }, commit: { author: { date: "2026-01-02T00:00:00Z" }, message: "second commit" }, html_url: "https://github.com/acme/project/commit/c2" }]);
      if (url.includes("/pulls?") || url.includes("/releases?")) return response([]);
      throw new Error(`unexpected GitHub request: ${url} ${String(init?.method ?? "GET")}`);
    };
    try {
      await syncGithubActivities(owner.toString());
      const first = await GithubConnectionModel.findOne({ ownerId: owner }).lean();
      assert.equal(first?.sync?.progress?.find((item) => item.kind === "commit")?.page, 2);
      assert.equal(await GithubActivityModel.countDocuments({ ownerId: owner, kind: "commit" }), 1);

      await syncGithubActivities(owner.toString());
      const second = await GithubConnectionModel.findOne({ ownerId: owner }).lean();
      assert.ok(requests.some((url) => url.includes("page=2")));
      assert.equal(await GithubActivityModel.countDocuments({ ownerId: owner, kind: "commit" }), 1);
      assert.ok(requests.some((url) => url.endsWith("/app/installations/99/access_tokens")));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("records revoked access as an error and does not treat permission denial as rate limiting", async () => {
    await connection();
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/commits?")) {
        requestCount += 1;
        return requestCount === 1
          ? new Response("forbidden", { status: 403, headers: { "x-ratelimit-remaining": "12" } })
          : new Response("revoked", { status: 401 });
      }
      if (url.includes("/pulls?") || url.includes("/releases?")) return response([]);
      throw new Error(`unexpected GitHub request: ${url}`);
    };
    try {
      await assert.rejects(() => syncGithubActivities(owner.toString()), (error: { code?: string }) => error.code === "GITHUB_FORBIDDEN");
      const failed = await GithubConnectionModel.findOne({ ownerId: owner }).lean();
      assert.equal(failed?.sync?.status, "error");
      await GithubConnectionModel.updateOne({ ownerId: owner }, { $set: { "sync.status": "idle" } });
      await assert.rejects(() => syncGithubActivities(owner.toString()), (error: { code?: string }) => error.code === "GITHUB_REVOKED");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fences a disconnect while a provider page is pending", async () => {
    await connection();
    const originalFetch = globalThis.fetch;
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = async (input) => {
      if (String(input).includes("/commits?")) {
        markStarted();
        await pending;
        return response([]);
      }
      return response([]);
    };
    try {
      const running = syncGithubActivities(owner.toString());
      await started;
      await GithubConnectionModel.updateOne({ ownerId: owner }, { $set: { status: "revoked" }, $inc: { connectionGeneration: 1 } });
      release();
      await assert.rejects(running, (error: { code?: string }) => error.code === "GITHUB_CONNECTION_CHANGED");
      assert.equal(await GithubActivityModel.countDocuments({ ownerId: owner }), 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("completes installation setup through user authorization and verifies installation access", async () => {
    const originalFetch = globalThis.fetch;
    const session = "session-cookie-value";
    const requests: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/app/installations/99")) return response({ id: 99, account: { id: 7, login: "octocat" } });
      if (url.endsWith("/login/oauth/access_token")) return response({ access_token: "user-token" });
      if (url.endsWith("/user")) return response({ id: 7, login: "octocat" });
      if (url.includes("/user/installations")) return response({ installations: [{ id: 99 }] });
      if (url.endsWith("/app/installations/99/access_tokens")) return response({ token: "installation-token", expires_at: new Date(Date.now() + 3600_000).toISOString() });
      if (url.includes("/installation/repositories")) return response([{ id: 42, full_name: "acme/project", private: true, default_branch: "main" }]);
      throw new Error(`unexpected GitHub request: ${url} ${String(init?.method ?? "GET")}`);
    };
    try {
      const started = await beginGithubConnection(owner.toString(), session);
      const state = new URL(started.authorizationUrl).searchParams.get("state");
      assert.ok(state);
      const authorizeUrl = await completeGithubConnection(state, "99", undefined, session);
      assert.match(authorizeUrl, /github\.com\/login\/oauth\/authorize/);
      const finished = await completeGithubConnection(state, "99", "authorization-code", session);
      assert.match(finished, /github=connected/);
      const saved = await GithubConnectionModel.findOne({ ownerId: owner }).lean();
      assert.equal(saved?.githubUserId, "7");
      assert.equal(saved?.repositories[0]?.fullName, "acme/project");
      assert.ok(requests.some((url) => url.endsWith("/user")));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects a user who cannot access the selected installation", async () => {
    const originalFetch = globalThis.fetch;
    const session = "session-cookie-unauthorized";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/app/installations/99")) return response({ id: 99, account: { id: 7, login: "octocat" } });
      if (url.endsWith("/login/oauth/access_token")) return response({ access_token: "user-token" });
      if (url.endsWith("/user")) return response({ id: 8, login: "other-user" });
      if (url.includes("/user/installations")) return response({ installations: [] });
      throw new Error(`unexpected GitHub request: ${url}`);
    };
    try {
      const started = await beginGithubConnection(owner.toString(), session);
      const state = new URL(started.authorizationUrl).searchParams.get("state");
      assert.ok(state);
      await completeGithubConnection(state, "99", undefined, session);
      const result = await completeGithubConnection(state, "99", "authorization-code", session);
      assert.match(result, /github=error/);
      assert.equal(await GithubConnectionModel.countDocuments({ ownerId: owner }), 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not advance progress after a page persistence failure", async () => {
    await connection();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/commits?")) return response([{ sha: "failure-1", author: { login: "octocat" }, commit: { author: { date: "2026-01-03T00:00:00Z" }, message: "persist me" }, html_url: "https://github.com/acme/project/commit/failure-1" }], { headers: { link: '<https://api.github.com/repos/acme/project/commits?page=2>; rel="next"' } });
      if (url.includes("/pulls?") || url.includes("/releases?")) return response([]);
      throw new Error(`unexpected GitHub request: ${url}`);
    };
    const originalUpsert = GithubActivityModel.findOneAndUpdate;
    GithubActivityModel.findOneAndUpdate = (() => { throw new Error("synthetic persistence failure"); }) as typeof originalUpsert;
    try {
      await assert.rejects(() => syncGithubActivities(owner.toString()));
      const saved = await GithubConnectionModel.findOne({ ownerId: owner }).lean();
      assert.equal(saved?.sync?.progress?.length ?? 0, 0);
    } finally {
      GithubActivityModel.findOneAndUpdate = originalUpsert;
      globalThis.fetch = originalFetch;
    }
  });
}
