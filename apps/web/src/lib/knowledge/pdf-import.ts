import {
  KNOWLEDGE_CONTENT_LIMITS,
  KNOWLEDGE_TITLE_LIMITS,
  validateRepositoryNote,
} from "./repository-zip-import";

export const PDF_IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxPages: 30,
  maxExtractedCharacters: 100_000,
  timeoutMs: 30_000,
} as const;

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

export interface PdfInspection {
  fileName: string;
  pageCount: number;
  pages: PdfPageText[];
  pagesWithoutText: number[];
}

export interface PdfTextItem {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

export interface PdfTextContent {
  items: Array<PdfTextItem | { type: string }>;
}

interface PdfPage {
  getTextContent(options: { includeMarkedContent: boolean }): Promise<PdfTextContent>;
  cleanup(): void;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}

interface PdfDocumentInit {
  data: Uint8Array;
  isEvalSupported: boolean;
  useWorkerFetch: boolean;
  disableAutoFetch: boolean;
  disableStream: boolean;
  disableFontFace: boolean;
  useSystemFonts: boolean;
}

export interface PdfParserModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(source: PdfDocumentInit): PdfLoadingTask;
}

export type PdfParserLoader = () => Promise<PdfParserModule>;

function abortError(): DOMException {
  return new DOMException("PDF extraction canceled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
}

function isTextItem(item: PdfTextContent["items"][number]): item is PdfTextItem {
  return "str" in item && typeof item.str === "string";
}

export function extractTextContent(content: PdfTextContent): string {
  let output = "";
  let previousY: number | null = null;
  for (const item of content.items) {
    if (!isTextItem(item) || item.str.length === 0) continue;
    const y = item.transform[5];
    if (output.length > 0 && previousY !== null && Math.abs(previousY - y) > 2) {
      output += "\n";
    } else if (
      output.length > 0 &&
      !/\s$/u.test(output) &&
      !/^[,.;:!?%)\]}]/u.test(item.str)
    ) {
      output += " ";
    }
    output += item.str;
    if (item.hasEOL) output += "\n";
    previousY = y;
  }
  return output.trim();
}

export function assemblePdfPages(pages: PdfPageText[]): string {
  return pages
    .slice()
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .filter((page) => page.text.trim().length > 0)
    .map((page) => `Page ${page.pageNumber}\n\n${page.text}`)
    .join("\n\n");
}

export function derivePdfTitle(fileName: string): string {
  return fileName.replace(/\.pdf$/iu, "").trim();
}

export function validatePdfNote(title: string, content: string): string | null {
  return validateRepositoryNote(title, content);
}

function mapPdfError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (
    error instanceof Error &&
    /No selectable text|too many pages|100,000-character limit|timed out|exceeds the 100,000/iu.test(
      error.message,
    )
  ) {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    ("name" in error && error.name === "PasswordException" ||
      "message" in error && typeof error.message === "string" &&
        /password|encrypted|需要密码/iu.test(error.message))
  ) {
    return new Error("Password-protected PDFs are not supported.");
  }
  return new Error("The PDF is invalid, corrupt, or could not be read.");
}

async function destroyQuietly(
  loadingTask: PdfLoadingTask | null,
  document: PdfDocument | null,
): Promise<void> {
  try {
    await document?.destroy();
  } finally {
    await loadingTask?.destroy();
  }
}

export async function inspectPdf(
  file: Blob & { name?: string },
  signal: AbortSignal,
  loadParser: PdfParserLoader,
  timeoutMs: number = PDF_IMPORT_LIMITS.timeoutMs,
  onPage?: (pageNumber: number, pageCount: number) => void,
): Promise<PdfInspection> {
  if (!/\.pdf$/iu.test(file.name ?? "")) {
    throw new Error("Choose a file with a .pdf extension.");
  }
  if (file.size > PDF_IMPORT_LIMITS.maxFileBytes) {
    throw new Error("The PDF is too large. Choose a file no larger than 10 MiB.");
  }
  throwIfAborted(signal);

  const timeoutController = new AbortController();
  const abort = () => timeoutController.abort(signal.reason ?? abortError());
  const onAbort = () => abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => timeoutController.abort(new Error("PDF extraction timed out.")), timeoutMs);
  let loadingTask: PdfLoadingTask | null = null;
  let document: PdfDocument | null = null;
  try {
    const parser = await loadParser();
    throwIfAborted(signal);
    if (typeof window !== "undefined") {
      parser.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url,
      ).toString();
    }
    const data = new Uint8Array(await file.arrayBuffer());
    throwIfAborted(signal);
    const source: PdfDocumentInit = {
      data,
      isEvalSupported: false,
      useWorkerFetch: false,
      disableAutoFetch: true,
      disableStream: true,
      disableFontFace: true,
      useSystemFonts: false,
    };
    loadingTask = parser.getDocument(source);
    timeoutController.signal.addEventListener("abort", () => void loadingTask?.destroy(), { once: true });
    document = await loadingTask.promise;
    throwIfAborted(signal);
    throwIfAborted(timeoutController.signal);
    if (document.numPages > PDF_IMPORT_LIMITS.maxPages) {
      throw new Error("The PDF has too many pages. Choose a document with at most 30 pages.");
    }

    const pages: PdfPageText[] = [];
    const pagesWithoutText: number[] = [];
    let extractedCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      throwIfAborted(signal);
      throwIfAborted(timeoutController.signal);
      onPage?.(pageNumber, document.numPages);
      const page: PdfPage = await document.getPage(pageNumber);
      try {
        const text = extractTextContent(await page.getTextContent({ includeMarkedContent: false }));
        if (text.length === 0) pagesWithoutText.push(pageNumber);
        extractedCharacters += text.length;
        if (extractedCharacters > PDF_IMPORT_LIMITS.maxExtractedCharacters) {
          throw new Error("The extracted PDF text exceeds the 100,000-character limit.");
        }
        pages.push({ pageNumber, text });
      } finally {
        page.cleanup();
      }
    }
    if (pages.every((page) => page.text.length === 0)) {
      throw new Error("No selectable text was found in this PDF. OCR is not supported.");
    }
    return {
      fileName: file.name ?? "document.pdf",
      pageCount: document.numPages,
      pages,
      pagesWithoutText,
    };
  } catch (error) {
    if (timeoutController.signal.aborted && !signal.aborted) {
      throw new Error("PDF extraction timed out after 30 seconds.");
    }
    throw mapPdfError(error);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    await destroyQuietly(loadingTask, document);
  }
}

export { KNOWLEDGE_CONTENT_LIMITS, KNOWLEDGE_TITLE_LIMITS };
