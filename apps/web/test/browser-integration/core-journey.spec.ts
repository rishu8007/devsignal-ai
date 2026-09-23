import { expect, test } from "@playwright/test";

test("runs the authenticated signal generation journey against the real API and MongoDB", async ({ page }) => {
  const email = `browser-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Name").fill("Browser Integration User");
  await page.getByLabel("Email").fill(email);
  await page.locator("#register-password").fill("BrowserIntegrationPassword123!");
  await page.locator("#register-confirm-password").fill("BrowserIntegrationPassword123!");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("BrowserIntegrationPassword123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByLabel("Topic or feature").fill("Isolated browser integration");
  await page.getByLabel("Learning notes").fill("A deterministic end-to-end test verifies the real API, MongoDB persistence, and the packaged web application.");
  await page.getByRole("button", { name: "Save signal" }).click();
  await expect(page.getByText("Signal saved successfully")).toBeVisible();
  await page.getByRole("button", { name: "View drafts" }).click();
  await page.getByRole("button", { name: "Generate three drafts" }).click();
  await expect(page.getByText(/Technical depth deterministic browser integration draft/)).toBeVisible();

  const firstApprove = page.getByRole("button", { name: "Approve" }).first();
  await firstApprove.click();
  await expect(page.getByText("Approved").first()).toBeVisible();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.locator("#calendar-heading")).toBeVisible();
  await page.getByRole("button", { name: "Usage" }).click();
  await expect(page.getByRole("heading", { name: "AI usage" })).toBeVisible();
});
