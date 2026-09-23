import { expect, test, type Page } from "@playwright/test";

const seededUser = { email: "browser-seeded@example.test", password: "BrowserIntegrationPassword123!" };
const otherUser = { email: "browser-other@example.test", password: "BrowserIntegrationPassword123!" };
const apiBaseUrl = "http://127.0.0.1:4100/api/v1";
const researchSignalTopic = "Browser research evidence";
const reviewSignalTopic = "Browser technical review";
const workflowSignalTopic = "Browser workflow approval";

async function signIn(page: Page, user = seededUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function signalCard(page: Page, topic: string) {
  return page.getByRole("heading", { name: topic }).locator("xpath=ancestor::li");
}

async function getCalls(page: Page) {
  const response = await page.request.get("http://127.0.0.1:8100/__test__/calls");
  expect(response.ok()).toBeTruthy();
  return await response.json() as { generations: number; retrievals: number; research: number; reviews: number; workflows: number };
}

test("research brief displays owned evidence, persists, becomes stale, and rejects another owner", async ({ page }) => {
  await signIn(page);
  const card = await signalCard(page, researchSignalTopic);
  await card.getByRole("button", { name: "Research" }).click();
  await expect(page.getByRole("region", { name: "Research brief" })).toBeVisible();
  await page.getByLabel("Browser research source").check();
  await page.getByRole("button", { name: "Build research brief" }).click();
  await expect(page.getByText("A deterministic browser research brief.")).toBeVisible();
  await page.getByText(/e1 · source/).click();
  await expect(page.getByText("Deterministic browser research evidence proves the local workflow boundary.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Return to Signal" }).click();
  await card.getByRole("button", { name: "Research" }).click();
  await expect(page.getByRole("button", { name: /succeeded/ })).toBeVisible();
  await page.getByRole("button", { name: /succeeded/ }).click();
  await expect(page.getByText("A deterministic browser research brief.")).toBeVisible();

  const sourceResponse = await page.request.get(`${apiBaseUrl}/sources`);
  const sourceBody = await sourceResponse.json() as { data: { sources: Array<{ id: string; title: string; content: string; contentVersion: number }> } };
  const source = sourceBody.data.sources.find((item) => item.title === "Browser research source");
  expect(source).toBeTruthy();
  const updated = await page.request.patch(`${apiBaseUrl}/sources/${source!.id}`, {
    data: {
      expectedContentVersion: source!.contentVersion,
      title: source!.title,
      content: `${source!.content} Updated through the supported source edit route.`,
    },
    headers: { Origin: "http://127.0.0.1:3200" },
  });
  expect(updated.status()).toBe(200);
  await page.getByRole("button", { name: "Return to Signal" }).click();
  await card.getByRole("button", { name: "Research" }).click();
  await page.getByRole("button", { name: /succeeded/ }).click();
  await expect(page.getByText("This historical brief is stale because the Signal or selected Knowledge changed.")).toBeVisible();

  const otherContext = await page.context().browser()!.newContext();
  const otherPage = await otherContext.newPage();
  try {
    await signIn(otherPage, otherUser);
    const signals = await otherPage.request.get(`${apiBaseUrl}/signals`);
    expect(signals.status()).toBe(200);
    const result = await otherPage.request.get(`${apiBaseUrl}/signals/${"6ab39abec9ce8add09440021"}/research`);
    expect(result.status()).toBe(404);
  } finally {
    await otherContext.close();
  }
});

test("technical review displays findings, rejects an edited draft, and reuses an identical request", async ({ page }) => {
  await signIn(page);
  const card = await signalCard(page, reviewSignalTopic);
  await card.getByRole("button", { name: "Research" }).click();
  await page.getByLabel("Browser review source").check();
  await page.getByRole("button", { name: "Build research brief" }).click();
  await expect(page.getByText("A deterministic browser research brief.")).toBeVisible();
  await page.getByRole("button", { name: "Return to Signal" }).click();
  await card.getByRole("button", { name: "View drafts" }).click();
  await page.getByRole("button", { name: "Generate three drafts" }).click();
  await expect(page.getByText(/Technical depth deterministic browser integration draft/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review draft" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Review draft" }).first().click();
  const reviewPanel = page.getByRole("region", { name: "Technical draft review" });
  await expect(reviewPanel).toBeVisible();

  const reviewRequestPromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/reviews"),
  );
  await reviewPanel.getByRole("button", { name: "Review draft" }).click();
  const reviewResponse = await reviewRequestPromise;
  if (!reviewResponse.ok()) throw new Error(`review response ${reviewResponse.status()} ${await reviewResponse.text()}`);
  const reviewRequest = reviewResponse.request();
  await expect(page.getByText("The technical draft is clear and evidence-linked.")).toBeVisible();
  await expect(page.getByText(/low · clarity/)).toBeVisible();
  const reviewUrl = reviewRequest.url();
  const reviewInput = JSON.parse(reviewRequest.postData() ?? "{}") as { requestId: string; researchBriefId: string };
  const beforeDuplicate = await getCalls(page);
  const duplicate = await page.request.post(reviewUrl, { data: reviewInput, headers: { Origin: "http://127.0.0.1:3200" } });
  expect(duplicate.status()).toBe(201);
  const afterDuplicate = await getCalls(page);
  expect(afterDuplicate.reviews).toBe(beforeDuplicate.reviews);

  const draftCard = page.locator("article").filter({ hasText: "Technical depth deterministic browser integration draft" }).first();
  await draftCard.getByRole("button", { name: "Edit" }).click();
  const editor = draftCard.locator("textarea");
  const changedDraft = `${await editor.inputValue()} This edit invalidates the previous technical review.`;
  await editor.fill(changedDraft);
  await draftCard.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(changedDraft)).toBeVisible();

  const review = (await duplicate.json() as { data: { review: { id: string; draftContentHash: string; proposedDraft: string | null } } }).data.review;
  const rejected = await page.request.post(`${reviewUrl}/${review.id}/apply`, {
    data: { expectedContentHash: review.draftContentHash, content: review.proposedDraft ?? changedDraft },
    headers: { Origin: "http://127.0.0.1:3200" },
  });
  expect(rejected.status()).toBe(409);
});

test("workflow reaches human approval, survives reload, approves explicitly, cancels safely, and is owner-scoped", async ({ page }) => {
  await signIn(page);
  const card = await signalCard(page, workflowSignalTopic);
  await card.getByRole("button", { name: "View drafts" }).click();
  await page.getByLabel("Browser workflow source").check();
  await page.getByRole("button", { name: "Start workflow" }).click();
  await expect(page.getByText("queued")).toBeVisible();

  await expect.poll(async () => {
    const response = await page.request.get(`${apiBaseUrl}/signals/6ab39abec9ce8add09440022/workflows`);
    const body = await response.json() as { data: { workflows: Array<{ status: string; id: string; errorCode?: string | null }> } };
    const workflow = body.data.workflows[0];
    return workflow ? `${workflow.status}:${workflow.errorCode ?? ""}:${workflow.id}` : "";
  }, { intervals: [250, 500, 1000], timeout: 20_000 }).toMatch(/awaiting_approval::[a-f0-9]{24}/);
  const workflowList = await page.request.get(`${apiBaseUrl}/signals/6ab39abec9ce8add09440022/workflows`);
  const workflowId = ((await workflowList.json()) as { data: { workflows: Array<{ id: string }> } }).data.workflows[0].id;
  await page.reload();
  const reloadedCard = await signalCard(page, workflowSignalTopic);
  await reloadedCard.getByRole("button", { name: "View drafts" }).click();
  await expect(page.getByText("Select a draft and review it before approval")).toBeVisible();
  const selected = page.locator('input[name="workflow-variation"]:checked');
  await expect(selected).toBeChecked();
  await expect(page.getByText("Current review")).toBeVisible();
  await page.getByRole("button", { name: "Approve selected draft" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`${apiBaseUrl}/signals/6ab39abec9ce8add09440022/workflows`);
    const body = await response.json() as { data: { workflows: Array<{ status: string }> } };
    return body.data.workflows[0]?.status;
  }, { intervals: [250, 500, 1000], timeout: 10_000 }).toBe("completed");
  await expect(page.getByText("completed")).toBeVisible();

  const otherContext = await page.context().browser()!.newContext();
  const otherPage = await otherContext.newPage();
  try {
    await signIn(otherPage, otherUser);
    const forbiddenGet = await otherPage.request.get(`${apiBaseUrl}/signals/6ab39abec9ce8add09440022/workflows/${workflowId}`);
    expect(forbiddenGet.status()).toBe(404);
    const forbiddenCancel = await otherPage.request.post(`${apiBaseUrl}/signals/6ab39abec9ce8add09440022/workflows/${workflowId}/cancel`, { data: {}, headers: { Origin: "http://127.0.0.1:3200" } });
    expect(forbiddenCancel.status()).toBe(404);
  } finally {
    await otherContext.close();
  }

  await page.getByLabel("Browser workflow source").check();
  await page.getByRole("button", { name: "Start workflow" }).click();
  await expect(page.getByText("queued")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(async () => {
    const response = await page.request.get(`${apiBaseUrl}/signals/6ab39abec9ce8add09440022/workflows`);
    const body = await response.json() as { data: { workflows: Array<{ status: string }> } };
    return body.data.workflows[0]?.status;
  }, { intervals: [250, 500, 1000], timeout: 10_000 }).toBe("cancelled");
});
