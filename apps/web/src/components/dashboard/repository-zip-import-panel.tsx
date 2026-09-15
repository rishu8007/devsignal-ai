"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  assembleRepositoryDocuments,
  deriveRepositoryTitle,
  inspectRepositoryZip,
  KNOWLEDGE_CONTENT_LIMITS,
  KNOWLEDGE_TITLE_LIMITS,
  validateRepositoryNote,
  type RepositoryZipInspection,
} from "@/lib/knowledge/repository-zip-import";

interface RepositoryZipImportPanelProps {
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

export function RepositoryZipImportPanel({
  active,
  disabled,
  formValues,
  onImport,
  onClose,
}: RepositoryZipImportPanelProps) {
  const [inspection, setInspection] = useState<RepositoryZipInspection | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  const selectedDocuments = useMemo(
    () => inspection?.files.filter((file) => selected.has(file.path)) ?? [],
    [inspection, selected],
  );
  const assembledContent = useMemo(
    () => assembleRepositoryDocuments(selectedDocuments),
    [selectedDocuments],
  );
  const contentLength = assembledContent.trim().length;
  const importAllowed =
    !disabled && selectedDocuments.length > 0 && validateRepositoryNote(title, assembledContent) === null;

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
    setPreviewPath(null);
    setTitle("");
    setError(null);
    setLoading(true);
    try {
      const nextInspection = await inspectRepositoryZip(file, abortController.signal);
      if (currentRequest !== requestId.current) return;
      setInspection(nextInspection);
      setTitle(deriveRepositoryTitle(file.name));
      setPreviewPath(nextInspection.files[0]?.path ?? null);
    } catch (caught: unknown) {
      if (currentRequest !== requestId.current) return;
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Unable to inspect the ZIP file.");
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
    <section className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4" aria-labelledby="repository-zip-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 id="repository-zip-heading" className="font-semibold text-slate-900">
            Import repository ZIP
          </h4>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Choose Markdown or text documentation locally. The archive is not uploaded.
          </p>
        </div>
        <button type="button" onClick={close} className="text-sm font-semibold text-slate-600">
          Cancel
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
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
          {loading ? "Inspecting ZIP..." : "Choose ZIP file"}
        </button>
      )}
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      {inspection && (
        <>
          <p className="mt-3 text-sm font-medium text-slate-800">
            Archive: {inspection.archiveName}
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="max-h-64 overflow-auto rounded border border-indigo-100 bg-white p-2">
              {inspection.files.map((file) => (
                <label key={file.path} className="flex gap-2 px-2 py-1 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selected.has(file.path)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(file.path)) next.delete(file.path);
                        else next.add(file.path);
                        return next;
                      })
                    }
                  />
                  <button type="button" className="truncate text-left" onClick={() => setPreviewPath(file.path)}>
                    {file.path}
                  </button>
                </label>
              ))}
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-indigo-100 bg-white p-3 text-xs text-slate-700">
              {inspection.files.find((file) => file.path === previewPath)?.text ?? "Select a file to preview it."}
            </pre>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            Selected files: {selectedDocuments.length}/{inspection.files.length}. Assembled note:
            {" "}{contentLength.toLocaleString()}/{KNOWLEDGE_CONTENT_LIMITS.max.toLocaleString()} characters.
          </p>
          {inspection.skipped.length > 0 && (
            <details className="mt-2 text-xs text-slate-600">
              <summary>Skipped files: {inspection.skipped.length}</summary>
              <ul className="mt-1 list-disc pl-5">
                {inspection.skipped.map((item) => <li key={`${item.path}:${item.reason}`}>{item.path}: {item.reason}</li>)}
              </ul>
            </details>
          )}
          <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="repository-zip-title">
            Proposed note title
          </label>
          <input
            id="repository-zip-title"
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
            <p className="mt-2 text-xs text-red-700">Select files that produce 10–20,000 trimmed characters; content is never truncated.</p>
          )}
        </>
      )}
    </section>
  );
}
