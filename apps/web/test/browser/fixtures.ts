import { expect, type Page, type Route } from "@playwright/test";

export const TEST_USER = {
  id: "browser-user",
  name: "Browser Test User",
  email: "browser@example.test",
  role: "user" as const,
  createdAt: "2025-01-01T00:00:00.000Z",
};

export const EMPTY_SOURCES = {
  success: true,
  data: {
    sources: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  },
};

function emptySignals() {
  return {
    success: true,
    data: { signals: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
  };
}

function emptyDrafts() {
  return {
    success: true,
    data: {
      drafts: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      summary: { approved: 0, scheduled: 0 },
    },
  };
}

function emptyCalendar() {
  return {
    success: true,
    data: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
  };
}

export type BrowserFixtures = {
  unexpected: string[];
  requests: Array<{ method: string; path: string; body: unknown }>;
};

export async function installApiFixtures(page: Page, searchBody?: object) {
  const fixtures: BrowserFixtures = { unexpected: [], requests: [] };
  let releaseSearch: (() => void) | undefined;
  const searchReleased = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });

  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.includes("/api/")) {
      await route.continue();
      return;
    }
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    let body: unknown = undefined;
    if (request.postData()) {
      try {
        body = JSON.parse(request.postData() as string);
      } catch {
        body = request.postData();
      }
    }
    fixtures.requests.push({ method: request.method(), path, body });

    if (request.method() === "GET" && path === "/auth/me") {
      await route.fulfill({ json: { success: true, data: { user: TEST_USER } } });
      return;
    }
    if (request.method() === "GET" && path === "/signals") {
      await route.fulfill({ json: emptySignals() });
      return;
    }
    if (request.method() === "GET" && path === "/drafts") {
      await route.fulfill({ json: emptyDrafts() });
      return;
    }
    if (request.method() === "GET" && path === "/calendar") {
      await route.fulfill({ json: emptyCalendar() });
      return;
    }
    if (request.method() === "GET" && path === "/sources") {
      await route.fulfill({ json: EMPTY_SOURCES });
      return;
    }
    if (request.method() === "GET" && path === "/notifications/unread-count") {
      await route.fulfill({ json: { success: true, data: { unread: 0 } } });
      return;
    }
    if (request.method() === "POST" && path === "/sources/search") {
      if (searchBody !== undefined && JSON.stringify(body) !== JSON.stringify(searchBody)) {
        fixtures.unexpected.push(`Unexpected search body: ${JSON.stringify(body)}`);
      }
      await searchReleased;
      await route.fulfill({
        json: {
          success: true,
          data: {
            candidates: [{
              sourceId: "source-1",
              title: "Trusted notes",
              contentVersion: 1,
              chunkId: "chunk-1",
              chunkIndex: 0,
              text: "Known browser search excerpt",
              startOffset: 0,
              endOffset: 28,
              score: 0.92,
            }],
          },
        },
      });
      return;
    }
    fixtures.unexpected.push(`${request.method()} ${path}`);
    await route.fulfill({ status: 500, json: { success: false, error: { code: "UNEXPECTED_TEST_REQUEST" } } });
  });

  return {
    fixtures,
    releaseSearch: () => releaseSearch?.(),
    expectNoUnexpectedRequests: () => expect(fixtures.unexpected).toEqual([]),
  };
}

export async function openKnowledge(page: Page) {
  await page.getByRole("button", { name: "Knowledge" }).click();
  await expect(page.getByRole("heading", { name: "Knowledge sources", exact: true })).toBeVisible();
}

export function makeTinyPdf(): Buffer {
  const stream = "BT /F1 18 Tf 72 720 Td (Browser PDF note text) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}
