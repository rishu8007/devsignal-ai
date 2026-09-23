import { expect, test } from "@playwright/test";

test("UI-only mocked API: connection cards, repository selection, Work filters, and idempotent conversion", async ({ page }) => {
  const requests: Array<{ method: string; path: string; body?: string }> = [];
  let selected = true;
  let converted = false;
  const repository = { id: 42, fullName: "acme/project", private: true, defaultBranch: "main", selected };
  const activity = { _id: "activity-1", repositoryFullName: "acme/project", kind: "commit", title: "Improve retrieval", summary: "Provider-backed activity", url: "https://github.com/acme/project/commit/1", occurredAt: "2026-01-03T00:00:00.000Z", authorLogin: "octocat", isPersonal: true, convertedSignalId: converted ? "signal-1" : null };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) {
      if (url.hostname === "github.com") return route.fulfill({ status: 200, contentType: "text/html", body: "authorization started" });
      return route.continue();
    }
    const path = url.pathname.replace("/api/v1", "");
    requests.push({ method: request.method(), path, body: request.postData() ?? undefined });
    if (request.method() === "GET" && path === "/auth/me") return route.fulfill({ json: { success: true, data: { user: { id: "browser-user", name: "Browser Test User", email: "browser@example.test", role: "user", createdAt: "2025-01-01T00:00:00.000Z" } } } });
    if (request.method() === "GET" && path === "/signals") return route.fulfill({ json: { success: true, data: { signals: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } } });
    if (request.method() === "GET" && path === "/drafts") return route.fulfill({ json: { success: true, data: { drafts: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }, summary: { approved: 0, scheduled: 0 } } } });
    if (request.method() === "GET" && path === "/calendar") return route.fulfill({ json: { success: true, data: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } } });
    if (request.method() === "GET" && path === "/sources") return route.fulfill({ json: { success: true, data: { sources: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } } });
    if (request.method() === "GET" && path === "/notifications/unread-count") return route.fulfill({ json: { success: true, data: { unread: 0 } } });
    if (request.method() === "GET" && path === "/connections/linkedin/status") return route.fulfill({ json: { success: true, data: { enabled: true, status: "disconnected", connected: false, publishingEnabled: false } } });
    if (request.method() === "GET" && path === "/connections/github/status") return route.fulfill({ json: { success: true, data: { enabled: true, status: "connected", identity: { login: "octocat", githubUserId: "7" }, repositories: [{ ...repository, selected }] , sync: { status: "idle", lastSuccessAt: "2026-01-03T00:00:00.000Z", lastError: null, nextEligibleAt: null } } } });
    if (request.method() === "POST" && path === "/connections/github/connect") return route.fulfill({ json: { success: true, data: { authorizationUrl: "https://github.com/apps/devsignal-test/installations/new" } } });
    if (request.method() === "PUT" && path === "/connections/github/repositories") { selected = false; return route.fulfill({ json: { success: true, data: { repositories: [{ ...repository, selected: false }] } } }); }
    if (request.method() === "GET" && path === "/connections/github/activities") return route.fulfill({ json: { success: true, data: { activities: [{ ...activity, convertedSignalId: converted ? "signal-1" : null }] } } });
    if (request.method() === "POST" && path === "/connections/github/activities/activity-1/signal") { converted = true; return route.fulfill({ json: { success: true, data: { signalId: "signal-1" } } }); }
    if (request.method() === "POST" && path === "/connections/github/sync") return route.fulfill({ json: { success: true, data: { activities: [{ ...activity }] } } });
    return route.fulfill({ status: 500, json: { success: false, error: { code: "UNEXPECTED_TEST_REQUEST" } } });
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connections" }).click();
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(() => requests.filter((request) => request.path === "/connections/github/connect")).toHaveLength(1);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connections" }).click();
  await page.getByRole("button", { name: "Save repositories" }).click();
  await expect.poll(() => requests.filter((request) => request.path === "/connections/github/repositories")).toHaveLength(1);
  await page.getByRole("button", { name: "Open work activity" }).click();
  await expect(page.getByRole("heading", { name: "GitHub Work" })).toBeVisible();
  await expect(page.getByText("Improve retrieval")).toBeVisible();
  await page.getByLabel("Type").selectOption("commit");
  await page.getByRole("button", { name: "Create Signal" }).click();
  await expect(page.getByText("Signal created")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Connections" }).click();
  await page.getByRole("button", { name: "Open work activity" }).click();
  await expect(page.getByText("Signal created")).toBeVisible();
  expect(requests.filter((request) => request.path === "/connections/github/activities/activity-1/signal")).toHaveLength(1);
});
