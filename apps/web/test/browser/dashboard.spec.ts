import { expect, test } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import {
  installApiFixtures,
  makeTinyPdf,
  openKnowledge,
} from "./fixtures";

test("loads the authenticated dashboard and restores it after reload", async ({ page }) => {
  const api = await installApiFixtures(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Turn today's progress into a signal/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Turn today's progress into a signal/ })).toBeVisible();
  api.expectNoUnexpectedRequests();
});

test("searches Knowledge only on submit and prevents duplicate pending submissions", async ({ page }) => {
  const api = await installApiFixtures(page, { query: "retrieval", limit: 5 });
  await page.goto("/dashboard");
  await openKnowledge(page);
  const input = page.getByLabel("Search query");
  await input.fill("retrieval");
  await expect(page.getByText("Known browser search excerpt")).toHaveCount(0);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("button", { name: "Searching..." })).toBeDisabled();
  await page.getByRole("button", { name: "Search" }).click({ force: true });
  expect(api.fixtures.requests.filter((request) => request.path === "/sources/search")).toHaveLength(1);
  api.releaseSearch();
  await expect(page.getByText("Known browser search excerpt")).toBeVisible();
  api.expectNoUnexpectedRequests();
});

test("extracts a selectable PDF in the browser and imports selected text without mutations", async ({ page }) => {
  const api = await installApiFixtures(page);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("/dashboard");
  await openKnowledge(page);
  await page.getByRole("button", { name: "Import PDF" }).click();
  await page.locator('section[aria-labelledby="pdf-import-heading"] input[type="file"]').setInputFiles({
    name: "browser-note.pdf",
    mimeType: "application/pdf",
    buffer: makeTinyPdf(),
  });
  await expect(page.getByText("browser-note.pdf · 1 pages")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Import into note" }).click();
  await expect(page.locator("#knowledge-source-content")).toHaveValue(/Browser PDF note text/);
  expect(pageErrors).toEqual([]);
  expect(api.fixtures.requests.filter((request) => request.method === "POST")).toEqual([]);
  api.expectNoUnexpectedRequests();
});

test("extracts supported ZIP files in deterministic order and excludes unsupported files", async ({ page }) => {
  const api = await installApiFixtures(page);
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add("docs/a.md", new TextReader("Alpha documentation"));
  await writer.add("docs/b.txt", new TextReader("Bravo documentation"));
  await writer.add("image.png", new TextReader("not documentation"));
  const zip = await writer.close();
  await page.goto("/dashboard");
  await openKnowledge(page);
  await page.getByRole("button", { name: "Import repository ZIP" }).click();
  await page.locator('section[aria-labelledby="repository-zip-heading"] input[type="file"]').setInputFiles({
    name: "docs.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(await zip.arrayBuffer()),
  });
  await expect(page.getByText("Archive: docs.zip")).toBeVisible();
  await expect(page.getByText("docs/a.md")).toBeVisible();
  await expect(page.getByText("docs/b.txt")).toBeVisible();
  await page.getByText(/Skipped files:/).click();
  await expect(page.getByText(/image\.png: unsupported file type/i)).toBeVisible();
  await page.getByLabel("docs/a.md").check();
  await page.getByLabel("docs/b.txt").check();
  await page.getByRole("button", { name: "Import into note" }).click();
  await expect(page.locator("#knowledge-source-content")).toHaveValue(/docs\/a\.md[\s\S]*Alpha documentation[\s\S]*docs\/b\.txt[\s\S]*Bravo documentation/);
  expect(api.fixtures.requests.filter((request) => request.method === "POST")).toEqual([]);
  api.expectNoUnexpectedRequests();
});

test("preserves unsaved text when replacement and navigation are dismissed", async ({ page }) => {
  const api = await installApiFixtures(page);
  await page.goto("/dashboard");
  await openKnowledge(page);
  await page.locator("#knowledge-source-title").fill("Existing title");
  await page.locator("#knowledge-source-content").fill("Existing note content that should remain.");
  await page.getByRole("button", { name: "Import PDF" }).click();
  await page.locator('section[aria-labelledby="pdf-import-heading"] input[type="file"]').setInputFiles({
    name: "replacement.pdf",
    mimeType: "application/pdf",
    buffer: makeTinyPdf(),
  });
  await expect(page.getByText("replacement.pdf · 1 pages")).toBeVisible();
  await page.getByRole("checkbox").check();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Import into note" }).click();
  await expect(page.locator("#knowledge-source-content")).toHaveValue("Existing note content that should remain.");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#knowledge-source-content")).toHaveValue("Existing note content that should remain.");
  api.expectNoUnexpectedRequests();
});
