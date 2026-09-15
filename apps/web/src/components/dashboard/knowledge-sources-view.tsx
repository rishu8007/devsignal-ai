"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { PdfImportPanel } from "./pdf-import-panel";
import { RepositoryZipImportPanel } from "./repository-zip-import-panel";
import { ApiClientError } from "@/lib/api/api-client";
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  getKnowledgeSource,
  indexKnowledgeSource,
  listKnowledgeSources,
  KNOWLEDGE_SEARCH_QUERY_MAX_CODE_POINTS,
  searchKnowledgeSources,
  updateKnowledgeSource,
  type KnowledgeSearchResponse,
  type KnowledgeSourceProcessingStatus,
  type KnowledgeSourceListResponse,
  type PublicKnowledgeSource,
} from "@/lib/api/knowledge-source-client";

const TITLE_MAX_LENGTH = 120;
const CONTENT_MIN_LENGTH = 10;
const CONTENT_MAX_LENGTH = 20_000;
const IMPORT_MAX_FILE_SIZE = 100 * 1024;

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
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [zipImportOpen, setZipImportOpen] = useState(false);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sourceList, setSourceList] = useState<KnowledgeSourceListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<KnowledgeSourceProcessingStatus | "all">("all");
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<PublicKnowledgeSource | null>(null);
  const [detailFallbackTitle, setDetailFallbackTitle] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailVersionNotice, setDetailVersionNotice] = useState<string | null>(null);
  const [detailSearchNotFound, setDetailSearchNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexingError, setIndexingError] = useState<string | null>(null);
  const [indexingConfirm, setIndexingConfirm] = useState(false);
  const [editingSource, setEditingSource] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTouched, setEditTouched] = useState({ title: false, content: false });
  const [editExpectedVersion, setEditExpectedVersion] = useState<number | null>(null);
  const [editPending, setEditPending] = useState(false);
  const [editStatusLoading, setEditStatusLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editConflict, setEditConflict] = useState(false);
  const [editUncertain, setEditUncertain] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const editController = useRef<AbortController | null>(null);
  const listRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const searchRequestId = useRef(0);
  const editRequestId = useRef(0);
  const listQueryKey = useRef("");
  const listDataRef = useRef<KnowledgeSourceListResponse | null>(null);
  const mounted = useRef(true);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const viewDetailsButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchedContentVersion = useRef<number | null>(null);
  const navigationIntentId = useRef(0);
  const importRequestId = useRef(0);
  const importInputRef = useRef<HTMLInputElement>(null);
  const formValuesRef = useRef({ title: "", content: "" });

  const titleLength = title.trim().length;
  const contentLength = content.trim().length;
  const searchQueryLength = Array.from(searchQuery.trim()).length;
  const editTitleLength = editTitle.trim().length;
  const editContentLength = editContent.trim().length;
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
  const editTitleError =
    editTouched.title && (editTitleLength < 1 || editTitleLength > TITLE_MAX_LENGTH)
      ? "Title must contain 1–120 trimmed characters."
      : null;
  const editContentError =
    editTouched.content &&
    (editContentLength < CONTENT_MIN_LENGTH || editContentLength > CONTENT_MAX_LENGTH)
      ? "Content must contain 10–20,000 trimmed characters."
      : null;
  const editFormValid =
    editTitleLength >= 1 &&
    editTitleLength <= TITLE_MAX_LENGTH &&
    editContentLength >= CONTENT_MIN_LENGTH &&
    editContentLength <= CONTENT_MAX_LENGTH;
  const editDirty =
    editingSource &&
    selectedSource !== null &&
    (editTitle.trim() !== selectedSource.title || editContent.trim() !== selectedSource.content);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listController.current?.abort();
      detailController.current?.abort();
      searchController.current?.abort();
      editController.current?.abort();
      importRequestId.current += 1;
    };
  }, []);

  useEffect(() => {
    onDirtyChange(formDirty || editDirty);
  }, [editDirty, formDirty, onDirtyChange]);

  const clearSourceState = useCallback(() => {
    listController.current?.abort();
    detailController.current?.abort();
    searchController.current?.abort();
    editController.current?.abort();
    listRequestId.current += 1;
    detailRequestId.current += 1;
    searchRequestId.current += 1;
    editRequestId.current += 1;
    listQueryKey.current = "";
    listDataRef.current = null;
    navigationIntentId.current = 0;
    searchedContentVersion.current = null;
    viewDetailsButtonRef.current = null;
    setSourceList(null);
    setPage(1);
    setStatusFilter("all");
    setListError(null);
    setSelectedSourceId(null);
    setSelectedSource(null);
    setDetailFallbackTitle(null);
    setDetailError(null);
    setDetailVersionNotice(null);
    setDetailSearchNotFound(false);
    setDetailLoading(false);
    setIndexing(false);
    setIndexingError(null);
    setIndexingConfirm(false);
    setEditingSource(false);
    setEditTitle("");
    setEditContent("");
    setEditTouched({ title: false, content: false });
    setEditExpectedVersion(null);
    setEditPending(false);
    setEditStatusLoading(false);
    setEditError(null);
    setEditConflict(false);
    setEditUncertain(false);
    setSearchResults(null);
    setSearchLoading(false);
    setSearchError(null);
    setImportLoading(false);
    setImportError(null);
    setZipImportOpen(false);
    setPdfImportOpen(false);
  }, []);

  useEffect(() => {
    formValuesRef.current = { title, content };
  }, [content, title]);

  useEffect(() => {
    if (active) return;
    importRequestId.current += 1;
    const timer = window.setTimeout(() => {
      if (mounted.current) {
        setImportLoading(false);
        setZipImportOpen(false);
        setPdfImportOpen(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (authenticated) return;
    const timer = window.setTimeout(() => {
      clearSourceState();
      setTitle("");
      setContent("");
      setTouched({ title: false, content: false });
      setFormError(null);
      setSuccessMessage(null);
      setImportError(null);
      setSearchQuery("");
      setEditingSource(false);
      onDirtyChange(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated, clearSourceState, onDirtyChange]);

  useEffect(() => {
    if (active && authenticated) return;
    searchController.current?.abort();
    searchRequestId.current += 1;
    const timer = window.setTimeout(() => {
      if (!mounted.current) return;
      setSearchLoading(false);
      if (!authenticated) {
        setSearchQuery("");
        setSearchResults(null);
        setSearchError(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, authenticated]);

  const loadSources = useCallback(async (requestedPage: number, force = false) => {
    const queryKey = `${requestedPage}:${statusFilter}`;
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
        processingStatus: statusFilter === "all" ? undefined : statusFilter,
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
  }, [onAuthenticationExpired, statusFilter]);

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

  const handleStatusFilterChange = useCallback((next: KnowledgeSourceProcessingStatus | "all") => {
    listController.current?.abort();
    listRequestId.current += 1;
    listQueryKey.current = "";
    listDataRef.current = null;
    setStatusFilter(next);
    setPage(1);
  }, []);

  const replaceSourceState = useCallback((updated: PublicKnowledgeSource) => {
    setSelectedSource(updated);
    setSourceList((current) => {
      if (!current) return current;
      const next = {
        ...current,
        sources: current.sources.map((source) =>
          source.id === updated.id ? updated : source,
        ),
      };
      listDataRef.current = next;
      return next;
    });
  }, []);

  const resetEditState = useCallback(() => {
    setEditingSource(false);
    setEditTitle("");
    setEditContent("");
    setEditTouched({ title: false, content: false });
    setEditExpectedVersion(null);
    setEditPending(false);
    setEditStatusLoading(false);
    setEditError(null);
    setEditConflict(false);
    setEditUncertain(false);
  }, []);

  const beginEditing = useCallback((source: PublicKnowledgeSource) => {
    setEditingSource(true);
    setEditTitle(source.title);
    setEditContent(source.content);
    setEditTouched({ title: false, content: false });
    setEditExpectedVersion(source.contentVersion);
    setEditError(null);
    setEditConflict(false);
    setEditUncertain(false);
  }, []);

  const handleViewDetails = useCallback(async (
    source: PublicKnowledgeSource,
    originButton?: HTMLButtonElement | null,
    searchedVersion?: number,
  ) => {
    if (indexing || deleting || editPending) return;
    if (
      editDirty &&
      source.id !== selectedSourceId &&
      !window.confirm("You have unsaved source edits. Leave this source?")
    ) {
      return;
    }
    resetEditState();
    const requestNumber = ++detailRequestId.current;
    const intentId = ++navigationIntentId.current;
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setSelectedSourceId(source.id);
    setSelectedSource(null);
    setDetailFallbackTitle(source.title);
    setDetailLoading(true);
    setDetailError(null);
    setDetailVersionNotice(null);
    setDetailSearchNotFound(false);
    setIndexingConfirm(false);
    setIndexingError(null);
    viewDetailsButtonRef.current = originButton ?? null;
    searchedContentVersion.current = searchedVersion ?? null;
    try {
      const result = await getKnowledgeSource(source.id, controller.signal);
      if (!mounted.current || requestNumber !== detailRequestId.current) return;
      setSelectedSource(result);
      if (
        searchedContentVersion.current !== null &&
        result.contentVersion !== searchedContentVersion.current
      ) {
        setDetailVersionNotice(
          `This source is now version ${result.contentVersion}; the search matched version ${searchedContentVersion.current}.`,
        );
      }
      // Schedule scroll and focus for next render, only if this was the user's intended navigation
      if (intentId === navigationIntentId.current) {
        window.setTimeout(() => {
          if (detailHeadingRef.current && mounted.current) {
            const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            detailHeadingRef.current.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
            detailHeadingRef.current.focus({ preventScroll: true });
          }
        }, 0);
      }
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      if (!mounted.current || requestNumber !== detailRequestId.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationExpired();
        return;
      }
      if (error instanceof ApiClientError && error.code === "SOURCE_NOT_FOUND") {
        if (searchedContentVersion.current !== null) {
          setDetailSearchNotFound(true);
          setDetailError("This search result is no longer current because the source is unavailable.");
        } else {
          setSelectedSourceId(null);
          setDetailError("This knowledge source is no longer available.");
          refreshSources();
        }
        return;
      }
      setDetailError("Unable to load this knowledge source. Please try again.");
    } finally {
      if (requestNumber === detailRequestId.current) {
        if (mounted.current) setDetailLoading(false);
        if (detailController.current === controller) detailController.current = null;
      }
    }
  }, [
    deleting,
    editDirty,
    editPending,
    indexing,
    onAuthenticationExpired,
    refreshSources,
    resetEditState,
    selectedSourceId,
  ]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ title: true, content: true });
    setFormError(null);
    setSuccessMessage(null);
    if (!formValid || deleting) return;

    setCreating(true);
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
      if (mounted.current) setCreating(false);
      onMutationPendingChange(false);
    }
  }

  const handleImportTextFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const requestNumber = ++importRequestId.current;
    const initialValues = formValuesRef.current;
    setImportError(null);
    setImportLoading(true);

    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (extension !== ".txt" && extension !== ".md") {
      setImportLoading(false);
      setImportError("Choose a .txt or .md file.");
      return;
    }
    if (file.size > IMPORT_MAX_FILE_SIZE) {
      setImportLoading(false);
      setImportError("The selected file is too large. Choose a file no larger than 100 KiB.");
      return;
    }

    try {
      const bytes = await file.arrayBuffer();
      if (!mounted.current || requestNumber !== importRequestId.current) return;
      const importedContent = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
      const trimmedContent = importedContent.trim();
      if (importedContent.includes("\0")) {
        throw new Error("Text files containing NUL characters cannot be imported.");
      }
      if (trimmedContent.length === 0) {
        throw new Error("The selected file is blank.");
      }
      if (
        trimmedContent.length < CONTENT_MIN_LENGTH ||
        trimmedContent.length > CONTENT_MAX_LENGTH
      ) {
        throw new Error("Imported content must contain 10–20,000 trimmed characters.");
      }

      const suggestedTitle = file.name.slice(0, file.name.length - extension.length).trim();
      if (suggestedTitle.length < 1 || suggestedTitle.length > TITLE_MAX_LENGTH) {
        throw new Error("The filename must suggest a title of 1–120 trimmed characters.");
      }
      if (
        formValuesRef.current.title !== initialValues.title ||
        formValuesRef.current.content !== initialValues.content
      ) {
        const replaceChangedInput = window.confirm(
          "The note form changed while the file was loading. Replace the current title and content with this file?",
        );
        if (!replaceChangedInput) {
          setImportError("Import canceled; your current note input was preserved.");
          return;
        }
      } else if (initialValues.title.length > 0 || initialValues.content.length > 0) {
        const replaceInput = window.confirm(
          "Replace the current title and content with this imported file?",
        );
        if (!replaceInput) {
          setImportError("Import canceled; your current note input was preserved.");
          return;
        }
      }
      if (!mounted.current || requestNumber !== importRequestId.current || !active) return;
      setTitle(suggestedTitle);
      setContent(importedContent);
      setTouched({ title: false, content: false });
      setFormError(null);
      setSuccessMessage(null);
    } catch (error: unknown) {
      if (!mounted.current || requestNumber !== importRequestId.current) return;
      setImportError(
        error instanceof TypeError
          ? "The selected file is not valid UTF-8 text."
          : error instanceof Error
            ? error.message
            : "Unable to read the selected file.",
      );
    } finally {
      if (requestNumber === importRequestId.current && mounted.current) {
        setImportLoading(false);
      }
    }
  }, [active]);

  const handleRepositoryZipImport = useCallback(
    (
      importedTitle: string,
      importedContent: string,
      initialValues: { title: string; content: string },
    ) => {
      if (!active || creating || deleting || indexing || editPending) return false;
      const currentValues = formValuesRef.current;
      const changedDuringImport =
        currentValues.title !== initialValues.title || currentValues.content !== initialValues.content;
      const hasCurrentInput = currentValues.title.length > 0 || currentValues.content.length > 0;
      if (
        (changedDuringImport &&
          !window.confirm(
            "The note form changed while the ZIP was loading. Replace the current title and content with this import?",
          )) ||
        (!changedDuringImport &&
          hasCurrentInput &&
          !window.confirm("Replace the current title and content with this import?"))
      ) {
        setImportError("Import canceled; your current note input was preserved.");
        return false;
      }
      setTitle(importedTitle.trim());
      setContent(importedContent);
      setTouched({ title: false, content: false });
      setFormError(null);
      setSuccessMessage(null);
      setImportError(null);
      return true;
    },
    [active, creating, deleting, editPending, indexing],
  );

  const handlePdfImport = useCallback(
    (
      importedTitle: string,
      importedContent: string,
      initialValues: { title: string; content: string },
    ) => {
      if (!active || creating || deleting || indexing || editPending) return false;
      const currentValues = formValuesRef.current;
      const changedDuringImport =
        currentValues.title !== initialValues.title || currentValues.content !== initialValues.content;
      const hasCurrentInput = currentValues.title.length > 0 || currentValues.content.length > 0;
      if (
        (changedDuringImport &&
          !window.confirm(
            "The note form changed while the PDF was loading. Replace the current title and content with this import?",
          )) ||
        (!changedDuringImport &&
          hasCurrentInput &&
          !window.confirm("Replace the current title and content with this PDF import?"))
      ) {
        setImportError("Import canceled; your current note input was preserved.");
        return false;
      }
      setTitle(importedTitle.trim());
      setContent(importedContent);
      setTouched({ title: false, content: false });
      setFormError(null);
      setSuccessMessage(null);
      setImportError(null);
      return true;
    },
    [active, creating, deleting, editPending, indexing],
  );

  const handleSaveEdit = useCallback(async () => {
    if (
      !selectedSource ||
      !editingSource ||
      !editFormValid ||
      !editDirty ||
      editExpectedVersion === null ||
      editPending ||
      deleting ||
      indexing
    ) {
      return;
    }

    const sourceId = selectedSource.id;
    const expectedContentVersion = editExpectedVersion;
    const requestNumber = ++editRequestId.current;
    editController.current?.abort();
    const controller = new AbortController();
    editController.current = controller;
    setEditPending(true);
    setEditError(null);
    setEditConflict(false);
    setEditUncertain(false);
    onMutationPendingChange(true);

    listRequestId.current += 1;
    detailRequestId.current += 1;
    searchRequestId.current += 1;
    listController.current?.abort();
    detailController.current?.abort();
    searchController.current?.abort();

    try {
      const updated = await updateKnowledgeSource(
        sourceId,
        {
          title: editTitle.trim(),
          content: editContent.trim(),
          expectedContentVersion,
        },
        controller.signal,
      );
      if (!mounted.current || requestNumber !== editRequestId.current) return;
      replaceSourceState(updated);
      setSelectedSourceId(updated.id);
      setSearchResults(null);
      setSearchError(null);
      setIndexingConfirm(false);
      setIndexingError(null);
      resetEditState();
      listQueryKey.current = "";
      listDataRef.current = null;
      void loadSources(page, true);
      listQueryKey.current = "";
      listDataRef.current = null;
      void loadSources(page, true);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      if (!mounted.current || requestNumber !== editRequestId.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationExpired();
      } else if (error instanceof ApiClientError && error.code === "SOURCE_VERSION_CONFLICT") {
        setEditConflict(true);
        setEditError("This source changed elsewhere. Reload the current source before saving your edits.");
      } else if (error instanceof ApiClientError && error.code === "SOURCE_INDEXING_IN_PROGRESS") {
        setEditError("Indexing is in progress. Wait for it to finish before saving this source.");
      } else if (
        error instanceof ApiClientError &&
        ["REQUEST_TIMEOUT", "NETWORK_ERROR"].includes(error.code)
      ) {
        setEditUncertain(true);
        setEditError("The save outcome is uncertain. Check the current source status before trying again.");
      } else if (error instanceof ApiClientError && error.code === "VALIDATION_ERROR") {
        setEditError("Please review the title and content limits.");
      } else {
        setEditError("Unable to save this source. Please try again.");
      }
    } finally {
      if (requestNumber === editRequestId.current) {
        if (mounted.current) setEditPending(false);
        if (editController.current === controller) editController.current = null;
      }
      onMutationPendingChange(false);
    }
  }, [
    deleting,
    editDirty,
    editExpectedVersion,
    editFormValid,
    editPending,
    editContent,
    editTitle,
    editingSource,
    indexing,
    onAuthenticationExpired,
    onMutationPendingChange,
    replaceSourceState,
    resetEditState,
    selectedSource,
    loadSources,
    page,
  ]);

  const handleCheckEditStatus = useCallback(async (reloadEdits: boolean) => {
    if (!selectedSourceId || editStatusLoading || editPending) return;
    const requestNumber = ++editRequestId.current;
    editController.current?.abort();
    const controller = new AbortController();
    editController.current = controller;
    setEditStatusLoading(true);
    setEditError(null);
    try {
      const current = await getKnowledgeSource(selectedSourceId, controller.signal);
      if (!mounted.current || requestNumber !== editRequestId.current) return;
      replaceSourceState(current);
      setEditUncertain(false);
      if (reloadEdits) {
        beginEditing(current);
      } else if (editExpectedVersion === current.contentVersion) {
        setEditConflict(false);
        setEditError("The current source is still on the version you edited. Your entered changes remain.");
      } else {
        setEditConflict(true);
        setEditError("The current source changed. Reload it explicitly before replacing your entered edits.");
      }
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      if (!mounted.current || requestNumber !== editRequestId.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationExpired();
      } else if (error instanceof ApiClientError && error.code === "SOURCE_NOT_FOUND") {
        setEditError("This source is no longer available.");
      } else {
        setEditError("Unable to check the current source. Please try again.");
      }
    } finally {
      if (requestNumber === editRequestId.current) {
        if (mounted.current) setEditStatusLoading(false);
        if (editController.current === controller) editController.current = null;
      }
    }
  }, [
    beginEditing,
    editExpectedVersion,
    editPending,
    editStatusLoading,
    onAuthenticationExpired,
    replaceSourceState,
    selectedSourceId,
  ]);

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
      setSearchResults(null);
      setSearchError(null);
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

  async function handleIndex() {
    if (!selectedSource || indexing || deleting) return;
    const sourceToIndex = selectedSource;

    setIndexing(true);
    setIndexingError(null);
    onMutationPendingChange(true);

    listRequestId.current += 1;
    detailRequestId.current += 1;
    listController.current?.abort();
    detailController.current?.abort();

    try {
      const indexingTimeoutMs = 200_000;
      const updated = await indexKnowledgeSource(sourceToIndex.id, indexingTimeoutMs);
      if (!mounted.current) return;
      setSelectedSource(updated);
      listQueryKey.current = "";
      listDataRef.current = null;
      void loadSources(page, true);

    } catch (error: unknown) {
      if (!mounted.current) return;
      setIndexingConfirm(false);
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationExpired();
      } else if (error instanceof ApiClientError && error.code === "SOURCE_NOT_FOUND") {
        setDetailError("This knowledge source was deleted.");
        setSelectedSourceId(null);
        setSelectedSource(null);
        refreshSources();
      } else if (error instanceof ApiClientError && error.code === "SOURCE_INDEXING_IN_PROGRESS") {
        setIndexingError(
          "Indexing is already in progress. Refresh status to check progress, or retry after the current operation completes.",
        );
      } else if (error instanceof ApiClientError && error.code === "SOURCE_INDEXING_STALE") {
        setIndexingError(
          "The indexing attempt is no longer current. Refresh status to check the result, then retry if needed.",
        );
      } else if (error instanceof ApiClientError && error.code === "REQUEST_TIMEOUT") {
        setIndexingError(
          "The indexing request did not complete within the timeout. Refresh status to check if indexing is still in progress.",
        );
      } else if (error instanceof ApiClientError && error.code === "NETWORK_ERROR") {
        setIndexingError(
          "A network error occurred. Refresh status to check if indexing completed.",
        );
      } else if (error instanceof ApiClientError && error.code === "AI_SERVICE_TIMEOUT") {
        setIndexingError(
          "The embedding service timed out. Refresh status to check if indexing is still in progress.",
        );
      } else if (error instanceof ApiClientError && error.code === "AI_SERVICE_UNAVAILABLE") {
        setIndexingError(
          "The embedding service is unavailable. Refresh status to check if indexing completed.",
        );
      } else {
        setIndexingError("Unable to index this knowledge source. Please try again.");
      }
    } finally {
      if (mounted.current) setIndexing(false);
      onMutationPendingChange(false);
    }
  }

  const handleSearch = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating || deleting || indexing || searchLoading) return;

    const query = searchQuery.trim();
    const queryLength = Array.from(query).length;
    setSearchResults(null);
    setSearchError(null);
    if (queryLength === 0) {
      setSearchError("Enter a search query.");
      return;
    }
    if (queryLength > KNOWLEDGE_SEARCH_QUERY_MAX_CODE_POINTS) {
      setSearchError("Search queries must be 1–1000 Unicode characters.");
      return;
    }

    const requestNumber = ++searchRequestId.current;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSearchLoading(true);
    try {
      const result = await searchKnowledgeSources(query, controller.signal);
      if (!mounted.current || requestNumber !== searchRequestId.current) return;
      setSearchResults(result);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      if (!mounted.current || requestNumber !== searchRequestId.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationExpired();
      } else if (
        error instanceof ApiClientError &&
        error.code === "KNOWLEDGE_RETRIEVAL_COLLECTION_MISSING"
      ) {
        setSearchError("Knowledge search is not initialized yet. Index a note before searching.");
      } else if (
        error instanceof ApiClientError &&
        [
          "KNOWLEDGE_RETRIEVAL_UNAVAILABLE",
          "AI_SERVICE_UNAVAILABLE",
          "AI_SERVICE_TIMEOUT",
          "NETWORK_ERROR",
          "REQUEST_TIMEOUT",
        ].includes(error.code)
      ) {
        setSearchError("Knowledge search is temporarily unavailable. Please try again later.");
      } else {
        setSearchError("Unable to search your knowledge notes. Please try again.");
      }
    } finally {
      if (requestNumber === searchRequestId.current) {
        if (mounted.current) setSearchLoading(false);
        if (searchController.current === controller) searchController.current = null;
      }
    }
  }, [
    creating,
    deleting,
    indexing,
    onAuthenticationExpired,
    searchLoading,
    searchQuery,
  ]);

  async function handleRefreshStatus() {
    if (!selectedSource || detailLoading || indexing) return;
    const sourceId = selectedSource.id;

    setDetailLoading(true);
    setDetailError(null);
    setIndexingError(null);

    detailController.current = new AbortController();
    const requestId = ++detailRequestId.current;

    try {
      const updated = await getKnowledgeSource(sourceId, detailController.current.signal);
      if (!mounted.current || requestId !== detailRequestId.current) return;
      setSelectedSource(updated);
      if (sourceList && sourceList.sources) {
        const updatedList = {
          ...sourceList,
          sources: sourceList.sources.map((s) =>
            s.id === updated.id ? updated : s,
          ),
        };
        setSourceList(updatedList);
        listDataRef.current = updatedList;
      }
    } catch (error: unknown) {
      if (!mounted.current || requestId !== detailRequestId.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        onAuthenticationExpired();
      } else if (error instanceof ApiClientError && error.code === "SOURCE_NOT_FOUND") {
        setDetailError("This knowledge source was deleted.");
        setSelectedSourceId(null);
        setSelectedSource(null);
        refreshSources();
      } else if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") {
        return;
      } else {
        setDetailError("Unable to refresh status. Please try again.");
      }
    } finally {
      if (mounted.current) setDetailLoading(false);
    }
  }

  const handleCancelEdit = useCallback(() => {
    if (editPending) return;
    resetEditState();
  }, [editPending, resetEditState]);

  const handleCloseDetails = useCallback(() => {
    if (
      editDirty &&
      !window.confirm("You have unsaved source edits. Close this source?")
    ) {
      return;
    }
    editController.current?.abort();
    editRequestId.current += 1;
    searchedContentVersion.current = null;
    resetEditState();
    setSelectedSourceId(null);
    setSelectedSource(null);
    setDetailFallbackTitle(null);
    setDetailError(null);
    setDetailVersionNotice(null);
    setDetailSearchNotFound(false);
    detailController.current?.abort();
    if (viewDetailsButtonRef.current && document.contains(viewDetailsButtonRef.current)) {
      viewDetailsButtonRef.current.focus();
    }
  }, [editDirty, resetEditState]);

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
          Save text notes for embedding and indexing. Notes are saved immediately.
          Indexing prepares your notes for AI use, and explicit search lets you inspect matching indexed text.
        </p>

        <form onSubmit={(event) => void handleCreate(event)} className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">Add a knowledge source</h3>
            <div className="flex flex-wrap gap-2">
              <input
                ref={importInputRef}
                id="knowledge-source-file"
                type="file"
                accept=".txt,.md"
                onChange={(event) => void handleImportTextFile(event)}
                disabled={creating || deleting || indexing || editPending || importLoading}
                className="sr-only"
              />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={creating || deleting || indexing || editPending || importLoading}
                aria-describedby="knowledge-source-file-help"
                className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importLoading ? "Importing..." : "Import text file"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportError(null);
                  setPdfImportOpen(false);
                  setZipImportOpen(true);
                }}
                disabled={creating || deleting || indexing || editPending || importLoading}
                className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Import repository ZIP
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportError(null);
                  setZipImportOpen(false);
                  setPdfImportOpen(true);
                }}
                disabled={creating || deleting || indexing || editPending || importLoading}
                className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Import PDF
              </button>
            </div>
          </div>
          <p id="knowledge-source-file-help" className="mt-2 text-xs leading-5 text-slate-500">
            Select one UTF-8 .txt or .md file up to 100 KiB. Importing fills this form locally;
            Save uploads the note, and indexing remains a separate explicit action.
          </p>
          <RepositoryZipImportPanel
            key={zipImportOpen ? "open" : "closed"}
            active={zipImportOpen && active}
            disabled={creating || deleting || indexing || editPending}
            formValues={{ title, content }}
            onImport={handleRepositoryZipImport}
            onClose={() => setZipImportOpen(false)}
          />
          <PdfImportPanel
            key={pdfImportOpen ? "open" : "closed"}
            active={pdfImportOpen && active}
            disabled={creating || deleting || indexing || editPending}
            formValues={{ title, content }}
            onImport={handlePdfImport}
            onClose={() => setPdfImportOpen(false)}
          />
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
          {importError && <p className="mt-3 text-sm font-medium text-red-700" role="alert">{importError}</p>}
          {formDirty && (
            <p className="mt-3 text-xs text-slate-500">
              Unsaved note input is preserved if you navigate away after confirmation.
            </p>
          )}
        </form>

        <section
          className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          aria-labelledby="knowledge-search-heading"
        >
          <h3 id="knowledge-search-heading" className="text-lg font-semibold text-slate-900">
            Search indexed notes
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Search notes that have been indexed. Each search may use an embedding provider and
            may incur a provider cost. Matches are supporting text, not confidence scores or
            factual verification.
          </p>
          <form onSubmit={(event) => void handleSearch(event)} className="mt-4" noValidate>
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="knowledge-search-query" className="text-sm font-medium text-slate-700">
                    Search query
                  </label>
                  <span className="text-xs text-slate-500">
                    {searchQueryLength}/{KNOWLEDGE_SEARCH_QUERY_MAX_CODE_POINTS}
                  </span>
                </div>
                <input
                  id="knowledge-search-query"
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  aria-describedby="knowledge-search-help"
                  aria-invalid={Boolean(searchError && !searchLoading)}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900"
                  placeholder="e.g. event-driven migration lessons"
                />
              </div>
              <button
                type="submit"
                disabled={creating || deleting || indexing || searchLoading}
                className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {searchLoading ? "Searching..." : "Search"}
              </button>
            </div>
            <p id="knowledge-search-help" className="mt-2 text-xs text-slate-500">
              Enter 1–{KNOWLEDGE_SEARCH_QUERY_MAX_CODE_POINTS} Unicode characters. Searches return up to 5 matching chunks.
            </p>
          </form>
          {searchLoading && (
            <p className="mt-4 text-sm text-slate-500" role="status">
              Searching indexed notes...
            </p>
          )}
          {!searchLoading && searchError && (
            <p className="mt-4 text-sm text-red-700" role="alert">{searchError}</p>
          )}
          {!searchLoading && !searchError && searchResults === null && (
            <p className="mt-4 text-sm text-slate-500">
              Submit a query to search your indexed notes.
            </p>
          )}
          {!searchLoading && !searchError && searchResults?.candidates.length === 0 && (
            <p className="mt-4 text-sm text-slate-500">
              No matching indexed notes were found.
            </p>
          )}
          {!searchLoading && !searchError && searchResults && searchResults.candidates.length > 0 && (
            <div className="mt-4 space-y-4" aria-label="Knowledge search results">
              {searchResults.candidates.map((candidate) => (
                <article key={candidate.chunkId} className="rounded-lg border border-slate-200 p-4">
                  <h4 className="font-semibold text-slate-900">{candidate.title}</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    Content version {candidate.contentVersion}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                    {candidate.text}
                  </p>
                  <button
                    type="button"
                    onClick={(event) => {
                      const source: PublicKnowledgeSource = {
                        id: candidate.sourceId,
                        title: candidate.title,
                        content: candidate.text,
                        contentVersion: candidate.contentVersion,
                        processingStatus: "indexed",
                        createdAt: "",
                        updatedAt: "",
                      };
                      void handleViewDetails(
                        source,
                        event.currentTarget,
                        candidate.contentVersion,
                      );
                    }}
                    disabled={creating || deleting || indexing || editPending}
                    className="mt-3 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    View current source
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Saved knowledge sources</h3>
            <p className="mt-1 text-sm text-slate-600">Filter sources by processing status.</p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="knowledge-source-status-filter" className="text-sm font-medium text-slate-700">
              Status
            </label>
            <select
              id="knowledge-source-status-filter"
              value={statusFilter}
              onChange={(event) =>
                handleStatusFilterChange(
                  event.target.value as KnowledgeSourceProcessingStatus | "all",
                )
              }
              disabled={listLoading || creating || deleting || indexing || editPending}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="indexing">Indexing</option>
              <option value="indexed">Indexed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

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
                  {source.processingStatus === "indexed"
                    ? "Indexed and ready for use."
                    : source.processingStatus === "failed"
                      ? "Indexing failed. Review the status and retry when ready."
                      : "Ready to index for AI use."}
                </p>
                <button
                  ref={(ref) => { if (ref) viewDetailsButtonRef.current = ref; }}
                  type="button"
                  onClick={(e) => void handleViewDetails(source, (e.currentTarget as HTMLButtonElement) ?? null)}
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
                <h3
                  ref={detailHeadingRef}
                  id="knowledge-source-detail-heading"
                  className="mt-2 text-xl font-semibold text-slate-900 scroll-mt-32"
                  tabIndex={-1}
                >
                  {selectedSource?.title ?? selectedListItem?.title ?? detailFallbackTitle ?? "Knowledge source"}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseDetails}
                disabled={editPending}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600"
              >
                Close
              </button>
            </div>
            {detailLoading && <p className="mt-4 text-sm text-slate-500" role="status">Loading source details...</p>}
            {detailError && <p className="mt-4 text-sm text-red-700" role="alert">{detailError}</p>}
            {detailSearchNotFound && (
              <button
                type="button"
                onClick={() => {
                  searchInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  searchInputRef.current?.focus();
                }}
                className="mt-3 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-700"
              >
                Search again manually
              </button>
            )}
            {selectedSource && !detailLoading && !detailError && (
              <>
                {detailVersionNotice && (
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
                    {detailVersionNotice}
                  </p>
                )}
                {editingSource ? (
                  <form
                    className="mt-4 space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSaveEdit();
                    }}
                    noValidate
                  >
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <label htmlFor="edit-knowledge-source-title" className="text-sm font-medium text-slate-700">
                          Title
                        </label>
                        <span className="text-xs text-slate-500">{editTitleLength}/{TITLE_MAX_LENGTH}</span>
                      </div>
                      <input
                        id="edit-knowledge-source-title"
                        value={editTitle}
                        maxLength={TITLE_MAX_LENGTH}
                        onChange={(event) => setEditTitle(event.target.value)}
                        onBlur={() => setEditTouched((current) => ({ ...current, title: true }))}
                        aria-invalid={Boolean(editTitleError)}
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                      />
                      {editTitleError && <p className="mt-1 text-sm text-red-700">{editTitleError}</p>}
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <label htmlFor="edit-knowledge-source-content" className="text-sm font-medium text-slate-700">
                          Text notes
                        </label>
                        <span className="text-xs text-slate-500">
                          {editContentLength.toLocaleString()}/{CONTENT_MAX_LENGTH.toLocaleString()}
                        </span>
                      </div>
                      <textarea
                        id="edit-knowledge-source-content"
                        value={editContent}
                        rows={8}
                        maxLength={CONTENT_MAX_LENGTH}
                        onChange={(event) => setEditContent(event.target.value)}
                        onBlur={() => setEditTouched((current) => ({ ...current, content: true }))}
                        aria-invalid={Boolean(editContentError)}
                        className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm leading-6 text-slate-900"
                      />
                      {editContentError && <p className="mt-1 text-sm text-red-700">{editContentError}</p>}
                    </div>
                    <p className="text-xs leading-5 text-slate-600">
                      Saving creates a new content version. Explicitly reindex this source before
                      the updated note can support searches or new grounded drafts.
                    </p>
                    {editError && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" role="alert">
                        <p className="text-sm text-amber-800">{editError}</p>
                        {editConflict && (
                          <button
                            type="button"
                            onClick={() => void handleCheckEditStatus(true)}
                            disabled={editStatusLoading || editPending}
                            className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {editStatusLoading ? "Reloading..." : "Reload current source"}
                          </button>
                        )}
                        {editUncertain && (
                          <button
                            type="button"
                            onClick={() => void handleCheckEditStatus(false)}
                            disabled={editStatusLoading || editPending}
                            className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {editStatusLoading ? "Checking..." : "Check save status"}
                          </button>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={!editFormValid || !editDirty || editPending || editStatusLoading || deleting || indexing}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {editPending ? "Saving..." : "Save changes"}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        disabled={editPending}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                    {selectedSource.content}
                  </p>
                )}
                <p className="mt-4 text-xs text-slate-500">
                  Version {selectedSource.contentVersion} · Updated {formatDate(selectedSource.updatedAt)}
                </p>
                {!editingSource && (
                <div className="mt-4 flex flex-wrap gap-3">
                  {selectedSource.processingStatus === "pending" && !indexingConfirm && (
                    <button
                      type="button"
                      onClick={() => setIndexingConfirm(true)}
                      disabled={indexing || deleting}
                      className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Index source
                    </button>
                  )}
                  {selectedSource.processingStatus === "failed" && !indexingConfirm && (
                    <button
                      type="button"
                      onClick={() => setIndexingConfirm(true)}
                      disabled={indexing || deleting}
                      className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Retry indexing
                    </button>
                  )}
                  {selectedSource.processingStatus === "indexing" && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRefreshStatus()}
                        disabled={detailLoading}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Refresh status
                      </button>
                      <button
                        type="button"
                        onClick={() => setIndexingConfirm(true)}
                        disabled={indexing || deleting}
                        className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Retry indexing
                      </button>
                    </div>
                  )}
                  {(selectedSource.processingStatus === "pending" || selectedSource.processingStatus === "failed" || selectedSource.processingStatus === "indexing") && indexingConfirm && (
                    <div className="w-full rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <p className="text-sm text-slate-700">
                        <span className="font-semibold">Important:</span> This sends your note to the configured
                        embedding provider and may incur usage costs. Retrying may incur additional costs.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleIndex()}
                          disabled={indexing || deleting}
                          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {indexing ? "Indexing..." : "Confirm and index"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIndexingConfirm(false)}
                          disabled={indexing}
                          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {selectedSource.processingStatus === "indexed" && (
                    <p className="text-sm text-teal-700">
                      ✓ Indexed. Available for search and optional knowledge-grounded drafts.
                    </p>
                  )}
                  {indexingError && (
                    <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm text-amber-800">{indexingError}</p>
                      <button
                        type="button"
                        onClick={() => void handleRefreshStatus()}
                        disabled={detailLoading}
                        className="mt-2 text-sm font-semibold text-amber-900 underline"
                      >
                        Refresh status
                      </button>
                    </div>
                  )}
                </div>
                )}
                {!editingSource && (
                  <button
                    type="button"
                    onClick={() => beginEditing(selectedSource)}
                    disabled={deleting || indexing}
                    className="mt-4 rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={editingSource || deleting || indexing}
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
