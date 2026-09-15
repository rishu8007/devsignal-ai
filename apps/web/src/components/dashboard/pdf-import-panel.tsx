"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  assemblePdfPages,
  derivePdfTitle,
  inspectPdf,
  KNOWLEDGE_CONTENT_LIMITS,
  KNOWLEDGE_TITLE_LIMITS,
  validatePdfNote,
  type PdfParserModule,
  type PdfInspection,
} from "@/lib/knowledge/pdf-import";

interface PdfImportPanelProps {
  active: boolean;
  disabled: boolean;
  formValues: { title: string; content: string };
  onImport: (
    title: string,
    content: string,
    initialValues: { title: string; content: string },
  ) => boolean;
  onClose: () => void;
}

async function loadPdfParser(): Promise<PdfParserModule> {
  return import("pdfjs-dist");
}

export function PdfImportPanel({
  active,
  disabled,
  formValues,
  onImport,
  onClose,
}: PdfImportPanelProps) {
  const [inspection, setInspection] = useState<PdfInspection | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ page: number; count: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const initialValues = useRef(formValues);

  useEffect(
    () => () => {
      requestId.current += 1;
      controller.current?.abort();
    },
    [],
  );

  const selectedPages = useMemo(
    () => inspection?.pages.filter((page) => selected.has(page.pageNumber)) ?? [],
    [inspection, selected],
  );
  const assembledContent = useMemo(() => assemblePdfPages(selectedPages), [selectedPages]);
  const contentLength = assembledContent.trim().length;
  const importAllowed =
    !disabled &&
    selectedPages.some((page) => page.text.trim().length > 0) &&
    validatePdfNote(title, assembledContent) === null;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const currentRequest = ++requestId.current;
    controller.current?.abort();
    const abortController = new AbortController();
    controller.current = abortController;
    initialValues.current = { ...formValues };
    setInspection(null);
    setSelected(new Set());
    setPreviewPage(null);
    setTitle("");
    setError(null);
    setProgress(null);
    setLoading(true);
    try {
      const nextInspection = await inspectPdf(
        file,
        abortController.signal,
        loadPdfParser,
        undefined,
        (page, count) => {
          if (currentRequest === requestId.current) setProgress({ page, count });
        },
      );
      if (currentRequest !== requestId.current) return;
      setInspection(nextInspection);
      setTitle(derivePdfTitle(file.name));
      setPreviewPage(nextInspection.pages[0]?.pageNumber ?? null);
    } catch (caught: unknown) {
      if (currentRequest !== requestId.current) return;
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Unable to read the PDF.");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  const close = () => {
    requestId.current += 1;
    controller.current?.abort();
    setLoading(false);
    onClose();
  };

  if (!active) return null;

  return (
    <section className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4" aria-labelledby="pdf-import-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 id="pdf-import-heading" className="font-semibold text-slate-900">Import PDF text</h4>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Extract selectable text locally. OCR and guaranteed layout reconstruction are not supported.
          </p>
        </div>
        <button type="button" onClick={close} className="text-sm font-semibold text-slate-600">Cancel</button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={(event) => void handleFile(event)}
        disabled={disabled || loading}
        className="sr-only"
      />
      {!inspection && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || loading}
          className="mt-3 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50"
        >
          {loading ? "Extracting PDF text..." : "Choose PDF file"}
        </button>
      )}
      {loading && (
        <p className="mt-3 text-sm text-slate-700" role="status">
          Extracting page {progress?.page ?? 1} of {progress?.count ?? "the document"} sequentially.
          You can cancel this operation.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      {inspection && (
        <>
          <p className="mt-3 text-sm font-medium text-slate-800">
            {inspection.fileName} · {inspection.pageCount} pages
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="max-h-64 overflow-auto rounded border border-indigo-100 bg-white p-2">
              {inspection.pages.map((page) => (
                <label key={page.pageNumber} className="flex gap-2 px-2 py-1 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selected.has(page.pageNumber)}
                    disabled={page.text.trim().length === 0}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(page.pageNumber)) next.delete(page.pageNumber);
                        else next.add(page.pageNumber);
                        return next;
                      })
                    }
                  />
                  <button type="button" className="text-left" onClick={() => setPreviewPage(page.pageNumber)}>
                    Page {page.pageNumber}{page.text.trim().length === 0 ? " (no selectable text)" : ""}
                  </button>
                </label>
              ))}
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-indigo-100 bg-white p-3 text-xs text-slate-700">
              {inspection.pages.find((page) => page.pageNumber === previewPage)?.text || "Select a page to preview it."}
            </pre>
          </div>
          {inspection.pagesWithoutText.length > 0 && (
            <p className="mt-2 text-xs text-slate-600">
              Pages without selectable text: {inspection.pagesWithoutText.join(", ")}. OCR is not supported.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-600">
            Selected pages: {selectedPages.length}/{inspection.pageCount}. Assembled note:
            {" "}{contentLength.toLocaleString()}/{KNOWLEDGE_CONTENT_LIMITS.max.toLocaleString()} characters.
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Selected pages become one knowledge source. Review the extracted text before saving.
          </p>
          <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="pdf-import-title">Proposed note title</label>
          <input
            id="pdf-import-title"
            value={title}
            maxLength={KNOWLEDGE_TITLE_LIMITS.max}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!importAllowed}
            onClick={() => {
              if (onImport(title, assembledContent, initialValues.current)) close();
            }}
            className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Import into note
          </button>
          {(contentLength > KNOWLEDGE_CONTENT_LIMITS.max || contentLength < KNOWLEDGE_CONTENT_LIMITS.min) && (
            <p className="mt-2 text-xs text-red-700">Select pages that produce 10–20,000 trimmed characters; content is never truncated.</p>
          )}
        </>
      )}
    </section>
  );
}
