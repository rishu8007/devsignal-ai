import { expect, test, type Page } from "@playwright/test";

const seededUser = { email: "browser-seeded@example.test", password: "BrowserIntegrationPassword123!" };
const otherUser = { email: "browser-other@example.test", password: "BrowserIntegrationPassword123!" };
const apiBaseUrl = "http://127.0.0.1:4100/api/v1";

async function signIn(page: Page, user = seededUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function openTab(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

test("notifications are owner-scoped, persist read state, and preserve unread records outside the display set", async ({ page }) => {
  await signIn(page);
  const notificationButton = page.getByRole("button", { name: /Notifications/ });
  await expect(notificationButton).toHaveAttribute("aria-label", /Notifications, \d+ unread/);
  const displayedBeforeRead = await page.request.get(`${apiBaseUrl}/notifications?page=1&limit=20`);
  expect(displayedBeforeRead.ok()).toBeTruthy();
  const displayedBody = await displayedBeforeRead.json() as { data: { notifications: Array<{ id: string }> } };
  expect(displayedBody.data.notifications).toHaveLength(20);
  await notificationButton.click();
  await expect(page.getByRole("region", { name: "Notification inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Browser publication Your isolated browser publication is ready/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark displayed read" }).click();
  const unreadAfterRead = await page.request.get(`${apiBaseUrl}/notifications/unread-count`);
  expect(unreadAfterRead.ok()).toBeTruthy();
  const unreadBody = await unreadAfterRead.json() as { data: { unreadCount: number } };
  expect(unreadBody.data.unreadCount).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible();

  const displayedAfterRead = await page.request.get(`${apiBaseUrl}/notifications?page=1&limit=20`);
  const displayedAfterBody = await displayedAfterRead.json() as { data: { notifications: Array<{ id: string; readAt: string | null }> } };
  expect(displayedAfterBody.data.notifications.every((item) => item.readAt !== null)).toBeTruthy();
  const readId = displayedAfterBody.data.notifications[0]?.id;
  expect(readId).toBeTruthy();

  const otherContext = await page.context().browser()?.newContext();
  expect(otherContext).toBeTruthy();
  const otherPage = await otherContext!.newPage();
  try {
    await signIn(otherPage, otherUser);
    const result = await otherPage.evaluate(async (id) => {
      const response = await fetch(`http://127.0.0.1:4100/api/v1/notifications/${id}/read`, {
        method: "POST",
        credentials: "include",
      });
      return { status: response.status, body: await response.json() as { data: { notification: unknown } } };
    }, readId);
    expect(result.status).toBe(200);
    const body = result.body;
    expect(body.data.notification).toBeNull();
    const otherNotifications = await otherPage.request.get(`${apiBaseUrl}/notifications?page=1&limit=20`);
    const otherBody = await otherNotifications.json() as { data: { notifications: Array<{ title: string; readAt: string | null }> } };
    expect(otherBody.data.notifications.find((item) => item.title === "Other owner")?.readAt).toBeNull();
  } finally {
    await otherContext!.close();
  }
});

test("analytics snapshots support create, edit, delete, reload, unknown values, and weighted rate coverage", async ({ page }) => {
  await signIn(page);
  await openTab(page, "Analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByText("2.73%")).toBeVisible();
  await expect(page.getByText("2 post(s)")).toBeVisible();
  await expect(page.getByText("3", { exact: true }).first()).toBeVisible();

  const recordButton = page.getByRole("button", { name: "Record snapshot" }).first();
  await recordButton.locator("xpath=ancestor::form").locator('input[name="impressions"]').fill("200");
  await recordButton.locator("xpath=ancestor::form").locator('input[name="reactions"]').fill("0");
  await recordButton.locator("xpath=ancestor::form").locator('input[name="comments"]').fill("0");
  await recordButton.locator("xpath=ancestor::form").locator('input[name="reposts"]').fill("0");
  await recordButton.locator("xpath=ancestor::form").locator('input[name="observedAt"]').fill("2026-09-22T12:00");
  await recordButton.click();
  await expect(page.getByRole("button", { name: "Save correction" }).first()).toBeVisible();
  await page.reload();
  await openTab(page, "Analytics");
  await expect(page.getByRole("button", { name: "Save correction" }).first()).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete snapshot" }).first().click();
  await expect(page.getByRole("button", { name: "Record snapshot" }).first()).toBeVisible();

  const otherContext = await page.context().browser()?.newContext();
  expect(otherContext).toBeTruthy();
  const otherPage = await otherContext!.newPage();
  try {
    await signIn(otherPage, otherUser);
    await openTab(otherPage, "Analytics");
    await expect(otherPage.getByText("No confirmed published posts in this range.")).toBeVisible();
  } finally {
    await otherContext!.close();
  }
});

test("knowledge text import previews locally, cancellation does not save, and explicit save persists", async ({ page }) => {
  await signIn(page);
  await openTab(page, "Knowledge");
  await page.locator("#knowledge-source-title").fill("Unsaved note");
  await page.locator("#knowledge-source-content").fill("This local draft must survive a cancelled replacement.");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import text file" }).click();
  const dialogPromise = page.waitForEvent("dialog");
  await (await chooser).setFiles({ name: "replacement.md", mimeType: "text/markdown", buffer: Buffer.from("# Imported browser note\nDeterministic content.") });
  const dialog = await dialogPromise;
  expect(dialog.message()).toMatch(/^Replace the current title and content with (this file|this imported file)\?$/);
  await dialog.dismiss();
  await expect(page.locator("#knowledge-source-content")).toHaveValue("This local draft must survive a cancelled replacement.");

  await page.locator("#knowledge-source-title").fill("Imported browser note");
  await page.locator("#knowledge-source-content").fill("Deterministic imported knowledge content that is long enough to save.");
  await page.getByRole("button", { name: "Save knowledge source" }).click();
  await expect(page.getByText("Knowledge source saved.")).toBeVisible();
  await page.reload();
  await openTab(page, "Knowledge");
  await expect(page.getByText("Imported browser note")).toBeVisible();
  await page.getByRole("button", { name: "View details" }).first().click();
  await expect(page.getByText("Deterministic imported knowledge content that is long enough to save.", { exact: true })).toBeVisible();
});

test("logout clears protected UI and direct owner-scoped API access is denied", async ({ page }) => {
  await signIn(page);
  await openTab(page, "Knowledge");
  await expect(page.getByRole("heading", { name: "Knowledge sources", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  const otherContext = await page.context().browser()?.newContext();
  expect(otherContext).toBeTruthy();
  const otherPage = await otherContext!.newPage();
  try {
    await signIn(otherPage, otherUser);
    const response = await otherPage.request.get(`${apiBaseUrl}/notifications`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json() as { data: { notifications: Array<{ title: string }> } };
    expect(body.data.notifications.some((item) => item.title === "Browser publication")).toBe(false);
  } finally {
    await otherContext!.close();
  }
});
