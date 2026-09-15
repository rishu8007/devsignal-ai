import assert from "node:assert/strict";
import test from "node:test";
import {
  assemblePdfPages,
  extractTextContent,
  inspectPdf,
  PDF_IMPORT_LIMITS,
  type PdfParserModule,
} from "../src/lib/knowledge/pdf-import";

function makePdfBlob(size = 1024): Blob & { name: string } {
  return Object.assign(new Blob([new Uint8Array(size)], { type: "application/pdf" }), {
    name: "notes.pdf",
  });
}

function makeTinyTextPdf(): Blob & { name: string } {
  const stream = "BT /F1 18 Tf 72 720 Td (Offline PDF smoke) Tj ET";
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
  return Object.assign(new Blob([pdf], { type: "application/pdf" }), { name: "smoke.pdf" });
}

function parserFor(
  document: {
    numPages: number;
    getPage(pageNumber: number): Promise<{
      getTextContent(): Promise<{ items: Array<{ str: string; transform: number[]; hasEOL?: boolean }> }>;
      cleanup(): void;
    }>;
    destroy(): Promise<void>;
  },
  promise = Promise.resolve(document),
): { parser: PdfParserModule; destroyed: () => boolean } {
  let wasDestroyed = false;
  return {
    parser: {
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({
        promise,
        destroy: async () => {
          wasDestroyed = true;
        },
      }),
    },
    destroyed: () => wasDestroyed,
  };
}

const emptyParserDocument = {
  numPages: 0,
  getPage: async () => ({
    getTextContent: async () => ({ items: [] }),
    cleanup: () => undefined,
  }),
  destroy: async () => undefined,
};

test("assembles selected pages in original order with page headings", () => {
  assert.equal(
    assemblePdfPages([
      { pageNumber: 3, text: "Third" },
      { pageNumber: 1, text: "First" },
      { pageNumber: 2, text: "" },
    ]),
    "Page 1\n\nFirst\n\nPage 3\n\nThird",
  );
});

test("converts parser text metadata into meaningful line breaks", () => {
  assert.equal(
    extractTextContent({
      items: [
        { str: "Hello", transform: [1, 0, 0, 1, 0, 20] },
        { str: "world", transform: [1, 0, 0, 1, 30, 20] },
        { str: "Next", transform: [1, 0, 0, 1, 0, 10] },
        { str: "line", transform: [1, 0, 0, 1, 30, 10] },
      ],
    }),
    "Hello world\nNext line",
  );
});

test("reports pages without text and rejects a document with no selectable text", async () => {
  const document = {
    numPages: 2,
    getPage: async (pageNumber: number) => ({
      getTextContent: async () => ({ items: pageNumber === 1 ? [{ str: "", transform: [1, 0, 0, 1, 0, 0] }] : [{ str: "Text", transform: [1, 0, 0, 1, 0, 0] }] }),
      cleanup: () => undefined,
    }),
    destroy: async () => undefined,
  };
  const result = await inspectPdf(makePdfBlob(), new AbortController().signal, async () => parserFor(document).parser);
  assert.deepEqual(result.pagesWithoutText, [1]);

  const emptyDocument = {
    ...document,
    getPage: async () => ({
      getTextContent: async () => ({ items: [] }),
      cleanup: () => undefined,
    }),
  };
  await assert.rejects(
    () => inspectPdf(makePdfBlob(), new AbortController().signal, async () => parserFor(emptyDocument).parser),
    /No selectable text/,
  );
});

test("enforces file, page, extracted text, password, and corrupt-document limits", async () => {
  await assert.rejects(
    () => inspectPdf(makePdfBlob(PDF_IMPORT_LIMITS.maxFileBytes + 1), new AbortController().signal, async () => parserFor(emptyParserDocument).parser),
    /too large/,
  );
  const tooManyPages = {
    numPages: PDF_IMPORT_LIMITS.maxPages + 1,
    getPage: async () => ({ getTextContent: async () => ({ items: [] }), cleanup: () => undefined }),
    destroy: async () => undefined,
  };
  await assert.rejects(
    () => inspectPdf(makePdfBlob(), new AbortController().signal, async () => parserFor(tooManyPages).parser),
    /too many pages/,
  );
  const tooMuchText = {
    numPages: 2,
    getPage: async () => ({
      getTextContent: async () => ({ items: [{ str: "x".repeat(50_001), transform: [1, 0, 0, 1, 0, 0] }] }),
      cleanup: () => undefined,
    }),
    destroy: async () => undefined,
  };
  await assert.rejects(
    () => inspectPdf(makePdfBlob(), new AbortController().signal, async () => parserFor(tooMuchText).parser),
    /100,000/,
  );
  const delayedDocument = new Promise<typeof emptyParserDocument>((resolve) => {
    setTimeout(() => resolve(emptyParserDocument), 20);
  });
  await assert.rejects(
    () => inspectPdf(makePdfBlob(), new AbortController().signal, async () => parserFor(emptyParserDocument, delayedDocument).parser, 1),
    /timed out/,
  );
  const passwordTask = parserFor(emptyParserDocument);
  passwordTask.parser.getDocument = () => ({
    promise: Promise.reject({ name: "PasswordException" }),
    destroy: async () => undefined,
  });
  await assert.rejects(
    () => inspectPdf(makePdfBlob(), new AbortController().signal, async () => passwordTask.parser),
    /Password-protected/,
  );
  const corruptTask = parserFor(emptyParserDocument);
  corruptTask.parser.getDocument = () => ({
    promise: Promise.reject(new Error("bad xref")),
    destroy: async () => undefined,
  });
  await assert.rejects(
    () => inspectPdf(makePdfBlob(), new AbortController().signal, async () => corruptTask.parser),
    /invalid, corrupt/,
  );
});

test("destroys the loading task on cancellation and ignores stale completion", async () => {
  let resolveDocument: ((document: typeof emptyParserDocument) => void) | undefined;
  const pending = new Promise<typeof emptyParserDocument>((resolve) => {
    resolveDocument = resolve;
  });
  const task = parserFor(emptyParserDocument, pending);
  const controller = new AbortController();
  const extraction = inspectPdf(makePdfBlob(), controller.signal, async () => task.parser);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  resolveDocument?.(emptyParserDocument);
  await assert.rejects(extraction, /canceled|aborted|invalid/i);
  assert.equal(task.destroyed(), true);
});

test("smoke-tests the locally installed PDF parser with a tiny text PDF", async () => {
  const parser = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const result = await inspectPdf(
    makeTinyTextPdf(),
    new AbortController().signal,
    async () => parser,
  );
  assert.equal(result.pageCount, 1);
  assert.match(result.pages[0]?.text ?? "", /Offline PDF smoke/);
});
