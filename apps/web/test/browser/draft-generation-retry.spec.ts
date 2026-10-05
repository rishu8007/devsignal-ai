import { expect, test, type Page } from "@playwright/test";

const signal = {
  id: "signal-1",
  topic: "Improve retrieval reliability",
  notes: "A saved signal for browser testing.",
  primaryAudience: "Recruiters & hiring teams",
  contentType: "Technical insight",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  revision: 1,
};

const indexedSource = {
  id: "source-1",
  title: "Retrieval notes",
  content: "Notes about reliable retrieval.",
  contentVersion: 1,
  processingStatus: "indexed",
  createdAt: signal.createdAt,
  updatedAt: signal.updatedAt,
};

const generatedDraftText =
  "A practical look at how reliable retrieval systems can improve engineering workflows by connecting relevant knowledge to each decision. " +
  "Careful evaluation, useful observability, and clear ownership help teams improve results over time.";

function generationResponse() {
  return {
    success: true,
    data: {
      generation: {
        id: "generation-1",
        signalId: signal.id,
        model: "mock-model",
        usedKnowledge: false,
        variations: [
          { id: "draft-1", angle: "technical_depth", content: generatedDraftText, status: "draft", scheduledFor: null, sourceCitations: [] },
          { id: "draft-2", angle: "learning_story", content: generatedDraftText, status: "draft", scheduledFor: null, sourceCitations: [] },
          { id: "draft-3", angle: "professional_impact", content: generatedDraftText, status: "draft", scheduledFor: null, sourceCitations: [] },
        ],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    },
  };
}

async function installDraftFixtures(
  page: Page,
  options: {
    getGeneration: (requestCount: number) => { status: number; body: object };
    createGeneration?: (requestCount: number) => Promise<{
      status: number;
      body: object;
      headers?: Record<string, string>;
    }> | {
      status: number;
      body: object;
      headers?: Record<string, string>;
    };
    editGeneration?: {
      status: number;
      body: object;
    };
    editNetworkFailure?: boolean;
  },
) {
  const requests: Array<{ method: string; path: string }> = [];
  let generationGets = 0;
  let generationPosts = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.includes("/api/")) {
      await route.continue();
      return;
    }
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    requests.push({ method: request.method(), path });
    if (request.method() === "GET" && path === "/auth/me") {
      await route.fulfill({ json: { success: true, data: { user: { id: "browser-user", name: "Browser User", email: "browser@example.test", role: "user", createdAt: signal.createdAt } } } });
    } else if (request.method() === "GET" && path === "/signals") {
      await route.fulfill({ json: { success: true, data: { signals: [signal], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } } } });
    } else if (request.method() === "GET" && path === "/drafts") {
      await route.fulfill({ json: { success: true, data: { drafts: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }, summary: { approved: 0, scheduled: 0 } } } });
    } else if (request.method() === "GET" && path === "/calendar") {
      await route.fulfill({ json: { success: true, data: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } } });
    } else if (request.method() === "GET" && path === "/sources") {
      await route.fulfill({ json: { success: true, data: { sources: [indexedSource], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } } } });
    } else if (request.method() === "GET" && path === "/notifications/unread-count") {
      await route.fulfill({ json: { success: true, data: { unread: 0 } } });
    } else if (request.method() === "GET" && path === `/signals/${signal.id}/workflows`) {
      await route.fulfill({ json: { success: true, data: { workflows: [] } } });
    } else if (request.method() === "GET" && path === `/signals/${signal.id}/research`) {
      await route.fulfill({ json: { success: true, data: { briefs: [] } } });
    } else if (request.method() === "POST" && path === `/signals/${signal.id}/research`) {
      await route.fulfill({ status: 503, json: { success: false, error: { code: "AI_SERVICE_UNAVAILABLE", message: "Research is temporarily unavailable." } } });
    } else if (path === `/signals/${signal.id}/generations` && request.method() === "GET") {
      generationGets += 1;
      const result = options.getGeneration(generationGets);
      await route.fulfill({ status: result.status, json: result.body });
    } else if (path === `/signals/${signal.id}/generations` && request.method() === "POST") {
      generationPosts += 1;
      const result = await options.createGeneration?.(generationPosts) ?? { status: 200, body: generationResponse() };
      await route.fulfill({ status: result.status, json: result.body, headers: result.headers });
    } else if (path === `/signals/${signal.id}/generations/draft-1` && request.method() === "PATCH") {
      if (options.editNetworkFailure) {
        await route.abort("failed");
        return;
      }
      const result = options.editGeneration ?? { status: 200, body: generationResponse() };
      await route.fulfill({ status: result.status, json: result.body });
    } else {
      await route.fulfill({ status: 500, json: { success: false, error: { code: "UNEXPECTED_TEST_REQUEST", message: "Unexpected test request" } } });
    }
  });
  return { requests };
}

const missingGeneration = {
  success: false,
  error: { code: "GENERATION_NOT_FOUND", message: "No generation exists for this signal" },
};

test("a new Signal stays empty until the user explicitly generates drafts", async ({ page }) => {
  const api = await installDraftFixtures(page, {
    getGeneration: () => ({ status: 404, body: missingGeneration }),
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "View drafts" }).click();
  await expect(page.getByText("No drafts generated yet.")).toBeVisible();
  expect(api.requests.filter((request) => request.method === "POST" && request.path.endsWith("/generations"))).toHaveLength(0);

  await page.getByRole("button", { name: "Generate three drafts" }).click();
  await expect(page.getByText(generatedDraftText).first()).toBeVisible();
  expect(api.requests.filter((request) => request.method === "POST" && request.path.endsWith("/generations"))).toHaveLength(1);
});

test("Retry after a failed creation repeats POST and preserves its safe error", async ({ page }) => {
  const api = await installDraftFixtures(page, {
    getGeneration: () => ({ status: 404, body: missingGeneration }),
    createGeneration: (requestCount) => requestCount === 1
      ? { status: 503, body: { success: false, error: { code: "AI_GENERATION_FAILED", message: "Draft generation is temporarily unavailable." } } }
      : { status: 200, body: generationResponse() },
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "View drafts" }).click();
  await expect(page.getByText("No drafts generated yet.")).toBeVisible();
  await page.getByRole("button", { name: "Generate three drafts" }).click();
  await expect(page.getByText("Draft generation is temporarily unavailable.")).toBeVisible();

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText(generatedDraftText).first()).toBeVisible();
  expect(api.requests.filter((request) => request.method === "GET" && request.path.endsWith("/generations"))).toHaveLength(1);
  expect(api.requests.filter((request) => request.method === "POST" && request.path.endsWith("/generations"))).toHaveLength(2);
});

test("rate limiting shows Retry-After cooldown without automatic retry", async ({ page }) => {
  const api = await installDraftFixtures(page, {
    getGeneration: () => ({ status: 404, body: missingGeneration }),
    createGeneration: () => ({
      status: 429,
      headers: { "Retry-After": "2", "Access-Control-Expose-Headers": "Retry-After" },
      body: {
        success: false,
        error: {
          code: "GENERATION_RATE_LIMIT_EXCEEDED",
          message: "Too many generation requests. Please try again later.",
        },
      },
    }),
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "View drafts" }).click();
  await expect(page.getByText("No drafts generated yet.")).toBeVisible();
  await page.getByRole("button", { name: "Generate three drafts" }).click();

  const retry = page.getByRole("button", { name: /Try again in \d+s/ });
  await expect(retry).toBeDisabled();
  await page.waitForTimeout(2_500);
  await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();
  expect(api.requests.filter((request) => request.method === "POST" && request.path.endsWith("/generations"))).toHaveLength(1);
});

test("a failed draft edit keeps the in-progress editor visible", async ({ page }) => {
  const api = await installDraftFixtures(page, {
    getGeneration: () => ({ status: 200, body: generationResponse() }),
    editGeneration: {
      status: 503,
      body: {
        success: false,
        error: { code: "AI_SERVICE_UNAVAILABLE", message: "Draft editing is temporarily unavailable." },
      },
    },
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "View drafts" }).click();
  await expect(page.getByRole("heading", { name: "Draft studio" })).toBeVisible();
  await expect(page.getByText(generatedDraftText).first()).toBeVisible();

  const editorContent = `${generatedDraftText} This edit must remain visible after the failed save.`;
  await expect(page.getByRole("button", { name: "Edit", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Edit Technical depth" }).fill(editorContent);
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(
    page.getByRole("article").filter({ hasText: "Technical depth" }).getByRole("alert"),
  ).toHaveText("Unable to save this edit. Please try again.");
  await expect(page.getByRole("textbox", { name: "Edit Technical depth" })).toHaveValue(editorContent);
  expect(api.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
});

test("a network-failed draft edit keeps text and offers saved-draft recovery without retrying PATCH", async ({ page }) => {
  const api = await installDraftFixtures(page, {
    getGeneration: () => ({ status: 200, body: generationResponse() }),
    editNetworkFailure: true,
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "View drafts" }).click();
  await expect(page.getByText(generatedDraftText).first()).toBeVisible();

  const editorContent = `${generatedDraftText} This uncertain edit must remain visible until recovery checks the server.`;
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Edit Technical depth" }).fill(editorContent);
  await page.getByRole("button", { name: "Save changes" }).click();

  const article = page.getByRole("article").filter({ hasText: "Technical depth" });
  await expect(article.getByRole("alert")).toHaveText(
    "The edit may still be processing. Check for saved drafts before trying again.",
  );
  await expect(page.getByRole("textbox", { name: "Edit Technical depth" })).toHaveValue(editorContent);
  await expect(article.getByRole("button", { name: "Check for saved drafts" })).toBeVisible();
  expect(api.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);

  await article.getByRole("button", { name: "Check for saved drafts" }).click();
  await expect(page.getByText(generatedDraftText).first()).toBeVisible();
  expect(api.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
  expect(api.requests.filter((request) => request.method === "GET" && request.path.endsWith("/generations"))).toHaveLength(2);
});

test("Retry after loading an existing generation repeats GET and displays saved drafts", async ({ page }) => {
  const api = await installDraftFixtures(page, {
    getGeneration: (requestCount) => requestCount === 1
      ? { status: 503, body: { success: false, error: { code: "TEMPORARY_FAILURE", message: "Temporary read failure." } } }
      : { status: 200, body: generationResponse() },
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "View drafts" }).click();
  await expect(page.getByText("Unable to load drafts. Please try again.")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText(generatedDraftText).first()).toBeVisible();
  expect(api.requests.filter((request) => request.method === "GET" && request.path.endsWith("/generations"))).toHaveLength(2);
  expect(api.requests.filter((request) => request.method === "POST" && request.path.endsWith("/generations"))).toHaveLength(0);
});

test("Research opens for the already-selected Signal during generation without starting research", async ({ page }) => {
  let finishGeneration!: (result: { status: number; body: object }) => void;
  const pendingGeneration = new Promise<{ status: number; body: object }>((resolve) => {
    finishGeneration = resolve;
  });
  const api = await installDraftFixtures(page, {
    getGeneration: () => ({ status: 404, body: missingGeneration }),
    createGeneration: () => pendingGeneration,
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "View drafts" }).click();
  await expect(page.getByText("No drafts generated yet.")).toBeVisible();
  await page.getByRole("button", { name: "Generate three drafts" }).click();
  await expect.poll(() => api.requests.filter(
    (request) => request.method === "POST" && request.path.endsWith("/generations"),
  )).toHaveLength(1);

  await page.getByRole("button", { name: "Research" }).click();
  const panel = page.getByRole("region", { name: "Research brief" });
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  await expect(panel).toBeInViewport();
  await expect(panel.getByText(indexedSource.title)).toBeVisible();
  await expect(page.getByRole("button", { name: "Build research brief" })).toBeDisabled();
  expect(api.requests.filter(
    (request) => request.method === "POST" && request.path.endsWith("/research"),
  )).toHaveLength(0);

  await panel.getByRole("checkbox", { name: indexedSource.title }).check();
  await expect(page.getByRole("button", { name: "Build research brief" })).toBeEnabled();
  expect(api.requests.filter(
    (request) => request.method === "POST" && request.path.endsWith("/research"),
  )).toHaveLength(0);
  await page.getByRole("button", { name: "Build research brief" }).click();
  await expect(page.getByText("Unable to build the research brief. Your Signal was not changed.")).toBeVisible();
  expect(api.requests.filter(
    (request) => request.method === "POST" && request.path.endsWith("/research"),
  )).toHaveLength(1);

  finishGeneration({
    status: 409,
    body: { success: false, error: { code: "AI_OPERATION_IN_PROGRESS", message: "This AI operation is already in progress." } },
  });
  await expect(page.getByText("This AI operation is already in progress.")).toBeVisible();
});
