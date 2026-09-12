"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  getKnowledgeSource,
  listKnowledgeSources,
  type KnowledgeSourceListResponse,
  type PublicKnowledgeSource,
} from "@/lib/api/knowledge-source-client";

const TITLE_MAX_LENGTH = 120;
const CONTENT_MIN_LENGTH = 10;
const CONTENT_MAX_LENGTH = 20_000;

interface KnowledgeSourcesViewProps {
  active: boolean;
  authenticated: boolean;
  onAuthenticationExpired: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onMutationPendingChange: (pending: boolean) => void;
}

export function KnowledgeSourcesView({
  active,
  authenticated,
  onAuthenticationExpired,
  onDirtyChange,
  onMutationPendingChange,
}: KnowledgeSourcesViewProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [touched, setTouched] = useState({ title: false, content: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sourceList, setSourceList] = useState<KnowledgeSourceListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<PublicKnowledgeSource | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const listRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const listQueryKey = useRef("");
  const listDataRef = useRef<KnowledgeSourceListResponse | null>(null);
  const mounted = useRef(true);

  const titleLength = title.trim().length;
  const contentLength = content.trim().length;
  const titleError =
    touched.title && (titleLength < 1 || titleLength > TITLE_MAX_LENGTH)
      ? "Title must contain 1–120 trimmed characters."
      : null;
  const contentError =
    touched.content && (contentLength < CONTENT_MIN_LENGTH || contentLength > CONTENT_MAX_LENGTH)
      ? "Content must contain 10–20,000 trimmed characters."
      : null;
  const formValid =
    titleLength >= 1 &&
    titleLength <= TITLE_MAX_LENGTH &&
    contentLength >= CONTENT_MIN_LENGTH &&
    contentLength <= CONTENT_MAX_LENGTH;
  const formDirty = title.length > 0 || content.length > 0;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listController.current?.abort();
      detailController.current?.abort();
    };
  }, []);

  useEffect(() => {
    onDirtyChange(formDirty);
  }, [formDirty, onDirtyChange]);

  const clearSourceState = useCallback(() => {
    listController.current?.abort();
    detailController.current?.abort();
    listRequestId.current += 1;
    detailRequestId.current += 1;
    listQueryKey.current = "";
    listDataRef.current = null;
    setSourceList(null);
    setPage(1);
    setListError(null);
    setSelectedSourceId(null);
    setSelectedSource(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (authenticated) return;
    const timer = window.setTimeout(() => {
      clearSourceState();
      setTitle("");
      setContent("");
      setTouched({ title: false, content: false });
      setFormError(null);
      setSuccessMessage(null);
      onDirtyChange(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated, clearSourceState, onDirtyChange]);

  const loadSources = useCallback(async (requestedPage: number, force = false) => {
    const queryKey = String(requestedPage);
    if (!force && listQueryKey.current === queryKey && listDataRef.current !== null) return;
    listQueryKey.current = queryKey;
    const requestNumber = ++listRequestId.current;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListLoading(true);
    setListError(null);
    try {
      const result = await listKnowledgeSources({
        page: requestedPage,
        limit: 20,
        signal: controller.signal,
      });
      if (!mounted.current || requestNumber !== listRequestId.current) return;
      listDataRef.current = result;
      setSourceList(result);
      if (requestedPage > Math.max(result.pagination.totalPages, 1)) {
        setPage(Math.max(result.pagination.totalPages, 1));
        listQueryKey.current = "";
      }
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      if (!mounted.current || requestNumber !== listRequestId.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationExpired();
        return;
      }
      setListError("Unable to load your knowledge sources. Please try again.");
    } finally {
      if (requestNumber === listRequestId.current) {
        if (mounted.current) setListLoading(false);
        if (listController.current === controller) listController.current = null;
      }
    }
  }, [onAuthenticationExpired]);

  useEffect(() => {
    if (!active || !authenticated) return;
    const timer = window.setTimeout(() => void loadSources(page), 0);
    return () => window.clearTimeout(timer);
  }, [active, authenticated, loadSources, page]);

  const refreshSources = useCallback(() => {
    listQueryKey.current = "";
    listDataRef.current = null;
    void loadSources(page, true);
  }, [loadSources, page]);

  const handleViewDetails = useCallback(async (source: PublicKnowledgeSource) => {
    const requestNumber = ++detailRequestId.current;
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setSelectedSourceId(source.id);
    setSelectedSource(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const result = await getKnowledgeSource(source.id, controller.signal);
      if (!mounted.current || requestNumber !== detailRequestId.current) return;
      setSelectedSource(result);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      if (!mounted.current || requestNumber !== detailRequestId.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationExpired();
        return;
      }
      if (error instanceof ApiClientError && error.code === "SOURCE_NOT_FOUND") {
        setSelectedSourceId(null);
        setDetailError("This knowledge source is no longer available.");
        refreshSources();
        return;
      }
      setDetailError("Unable to load this knowledge source. Please try again.");
    } finally {
      if (requestNumber === detailRequestId.current) {
        if (mounted.current) setDetailLoading(false);
        if (detailController.current === controller) detailController.current = null;
      }
    }
  }, [onAuthenticationExpired, refreshSources]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ title: true, content: true });
    setFormError(null);
    setSuccessMessage(null);
    if (!formValid || deleting) return;

    onMutationPendingChange(true);
    try {
      await createKnowledgeSource({ title: title.trim(), content: content.trim() });
      if (!mounted.current) return;
      setTitle("");
      setContent("");
      setTouched({ title: false, content: false });
      setSuccessMessage("Knowledge source saved.");
      setPage(1);
      listQueryKey.current = "";
      listDataRef.current = null;
      void loadSources(1, true);
    } catch (error: unknown) {
      if (!mounted.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationExpired();
      } else if (error instanceof ApiClientError && error.code === "VALIDATION_ERROR") {
        setFormError("Please review the title and content limits.");
      } else {
        setFormError("Unable to save this knowledge source. Please try again.");
      }
    } finally {
      onMutationPendingChange(false);
    }
  }

  async function handleDelete() {
    if (!selectedSource || deleting) return;
    const sourceToDelete = selectedSource;
    if (!window.confirm(`Delete "${sourceToDelete.title}"? This cannot be undone.`)) return;

    setDeleting(true);
    onMutationPendingChange(true);
    try {
      await deleteKnowledgeSource(sourceToDelete.id);
      if (!mounted.current) return;
      setSelectedSourceId(null);
      setSelectedSource(null);
      setDetailError(null);
      listQueryKey.current = "";
      listDataRef.current = null;
      void loadSources(page, true);
    } catch (error: unknown) {
      if (!mounted.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationExpired();
      } else if (error instanceof ApiClientError && error.code === "SOURCE_NOT_FOUND") {
        setSelectedSourceId(null);
        setSelectedSource(null);
        setDetailError("This knowledge source was already deleted.");
        refreshSources();
      } else {
        setDetailError("Unable to delete this knowledge source. Please try again.");
      }
    } finally {
      if (mounted.current) setDeleting(false);
      onMutationPendingChange(false);
    }
  }

  const selectedListItem = useMemo(
    () => sourceList?.sources.find((source) => source.id === selectedSourceId) ?? null,
    [selectedSourceId, sourceList],
  );

  return (
    <div className={active ? "mt-8" : "hidden"} aria-hidden={!active}>
      <section aria-labelledby="knowledge-sources-heading">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">
          Personal knowledge
        </p>
        <h2 id="knowledge-sources-heading" className="mt-2 text-2xl font-semibold text-slate-900">
          Knowledge sources
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Save text notes for future grounded generation. Notes are saved now,
          but indexing and use in AI generation are not available yet.
        </p>

        <form onSubmit={(event) => void handleCreate(event)} className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
          <h3 className="text-lg font-semibold text-slate-900">Add a knowledge source</h3>
          <div className="mt-4 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="knowledge-source-title" className="text-sm font-medium text-slate-700">
                  Title
                </label>
                <span className="text-xs text-slate-500">{titleLength}/{TITLE_MAX_LENGTH}</span>
              </div>
              <input
                id="knowledge-source-title"
                value={title}
                maxLength={TITLE_MAX_LENGTH}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setFormError(null);
                  setSuccessMessage(null);
                }}
                onBlur={() => setTouched((current) => ({ ...current, title: true }))}
                aria-invalid={Boolean(titleError)}
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900"
                placeholder="e.g. Notes from the event-driven migration"
              />
              {titleError && <p className="mt-1 text-sm text-red-700">{titleError}</p>}
            </div>
            <div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="knowledge-source-content" className="text-sm font-medium text-slate-700">
                  Text notes
                </label>
                <span className="text-xs text-slate-500">
                  {contentLength.toLocaleString()}/{CONTENT_MAX_LENGTH.toLocaleString()}
                </span>
              </div>
              <textarea
                id="knowledge-source-content"
                value={content}
                rows={7}
                maxLength={CONTENT_MAX_LENGTH}
                onChange={(event) => {
                  setContent(event.target.value);
                  setFormError(null);
                  setSuccessMessage(null);
                }}
                onBlur={() => setTouched((current) => ({ ...current, content: true }))}
                aria-invalid={Boolean(contentError)}
                className="mt-2 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6 text-slate-900"
                placeholder="Capture an experience, decision, lesson, or technical detail."
              />
              {contentError && <p className="mt-1 text-sm text-red-700">{contentError}</p>}
            </div>
          </div>
          <button
            type="submit"
            disabled={!formValid || deleting}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Save knowledge source
          </button>
          {successMessage && <p className="mt-3 text-sm font-medium text-teal-700" role="status">{successMessage}</p>}
          {formError && <p className="mt-3 text-sm font-medium text-red-700" role="alert">{formError}</p>}
          {formDirty && (
            <p className="mt-3 text-xs text-slate-500">
              Unsaved note input is preserved if you navigate away after confirmation.
            </p>
          )}
        </form>

        {listLoading && (
          <p className="mt-6 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500" role="status">
            Loading knowledge sources...
          </p>
        )}
        {!listLoading && listError && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
            <p className="text-sm text-red-700">{listError}</p>
            <button type="button" onClick={refreshSources} className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">
              Retry
            </button>
          </div>
        )}
        {!listLoading && !listError && sourceList && sourceList.sources.length === 0 && (
          <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white/70 p-5 text-sm text-slate-500">
            No knowledge sources yet. Add a text note above to get started.
          </p>
        )}
        {!listLoading && !listError && sourceList && sourceList.sources.length > 0 && (
          <div className="mt-6 grid gap-4">
            {sourceList.sources.map((source) => (
              <article key={source.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{source.title}</h3>
                    <p className="mt-2 text-sm text-slate-500">
                      Saved {formatDate(source.createdAt)}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    {formatProcessingStatus(source.processingStatus)}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  Notes are saved. Indexing and AI use are not available yet.
                </p>
                <button
                  type="button"
                  onClick={() => void handleViewDetails(source)}
                  className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  View details
                </button>
              </article>
            ))}
          </div>
        )}
        {sourceList && sourceList.pagination.totalPages > 0 && (
          <div className="mt-5 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Page {sourceList.pagination.page} of {sourceList.pagination.totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => current - 1)}
                disabled={page <= 1 || listLoading}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={page >= sourceList.pagination.totalPages || listLoading}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {selectedSourceId && (
          <aside className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5" aria-labelledby="knowledge-source-detail-heading">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">Source details</p>
                <h3 id="knowledge-source-detail-heading" className="mt-2 text-xl font-semibold text-slate-900">
                  {selectedSource?.title ?? selectedListItem?.title ?? "Knowledge source"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedSourceId(null);
                  setSelectedSource(null);
                  detailController.current?.abort();
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600"
              >
                Close
              </button>
            </div>
            {detailLoading && <p className="mt-4 text-sm text-slate-500" role="status">Loading source details...</p>}
            {detailError && <p className="mt-4 text-sm text-red-700" role="alert">{detailError}</p>}
            {selectedSource && !detailLoading && !detailError && (
              <>
                <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                  {selectedSource.content}
                </p>
                <p className="mt-4 text-xs text-slate-500">
                  Version {selectedSource.contentVersion} · Updated {formatDate(selectedSource.updatedAt)}
                </p>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : `Delete "${selectedSource.title}"`}
                </button>
              </>
            )}
          </aside>
        )}
      </section>
    </div>
  );
}

function formatProcessingStatus(status: PublicKnowledgeSource["processingStatus"]): string {
  if (status === "pending") return "Pending indexing";
  if (status === "indexing") return "Indexing";
  if (status === "indexed") return "Indexed";
  return "Indexing failed";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
