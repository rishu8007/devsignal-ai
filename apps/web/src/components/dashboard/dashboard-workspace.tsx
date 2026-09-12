"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import {
  approveGeneration,
  createGeneration,
  editGeneration,
  getGeneration,
  type PublicDraft,
  type PublicGeneration,
} from "@/lib/api/generation-client";
import { createSignal, listSignals, type PublicSignal, type SignalPayload } from "@/lib/api/signal-client";
import { listDrafts, type DraftLibraryResponse, type PublicDraftLibraryItem } from "@/lib/api/draft-client";
import { useAuth } from "@/components/auth/auth-provider";
import { DraftStudio } from "@/components/dashboard/draft-studio";
import { NewSignalForm } from "@/components/dashboard/new-signal-form";
import { RecentSignals } from "@/components/dashboard/recent-signals";
import { WorkspaceNavigation } from "@/components/dashboard/workspace-navigation";
import { type WorkspaceTab } from "@/components/dashboard/workspace-navigation";
import { WorkspaceOverview } from "@/components/dashboard/workspace-overview";
import { DraftsView } from "@/components/dashboard/drafts-view";

export function DashboardWorkspace() {
  const { invalidateSession, status: authStatus } = useAuth();
  const [signals, setSignals] = useState<PublicSignal[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<PublicSignal | null>(null);
  const [generation, setGeneration] = useState<PublicGeneration | null>(null);
  const [generationLoading, setGenerationLoading] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationPending, setGenerationPending] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationUncertain, setMutationUncertain] = useState(false);
  const [editingVariationId, setEditingVariationId] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("create");
  const [draftFilter, setDraftFilter] = useState<"all" | "draft" | "approved">("all");
  const [draftPage, setDraftPage] = useState(1);
  const [draftLibrary, setDraftLibrary] = useState<DraftLibraryResponse | null>(null);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [generationOutcomeUncertain, setGenerationOutcomeUncertain] = useState(false);
  const requestId = useRef(0);
  const listController = useRef<AbortController | null>(null);
  const generationRequestId = useRef(0);
  const generationController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const draftRequestId = useRef(0);
  const draftController = useRef<AbortController | null>(null);
  const draftQueryKey = useRef("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listController.current?.abort();
      generationController.current?.abort();
      draftController.current?.abort();
    };
  }, []);

  const loadDraftLibrary = useCallback(async (page: number, filter: "all" | "draft" | "approved") => {
    const queryKey = `${page}:${filter}`;
    if (draftQueryKey.current === queryKey && draftLibrary !== null) return;
    draftQueryKey.current = queryKey;
    const currentRequest = ++draftRequestId.current;
    draftController.current?.abort();
    const controller = new AbortController();
    draftController.current = controller;
    setDraftsLoading(true);
    setDraftsError(null);
    try {
      const result = await listDrafts({
        page,
        limit: 20,
        status: filter === "all" ? undefined : filter,
        signal: controller.signal,
      });
      if (!mounted.current || currentRequest !== draftRequestId.current) return;
      setDraftLibrary(result);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      if (!mounted.current || currentRequest !== draftRequestId.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        invalidateSession();
        return;
      }
      setDraftsError("Unable to load your drafts. Please try again.");
    } finally {
      if (currentRequest === draftRequestId.current) {
        if (mounted.current) setDraftsLoading(false);
        if (draftController.current === controller) draftController.current = null;
      }
    }
  }, [draftLibrary, invalidateSession]);

  const refreshDraftLibrary = useCallback(() => {
    draftQueryKey.current = "";
    void loadDraftLibrary(draftPage, draftFilter);
  }, [draftFilter, draftPage, loadDraftLibrary]);

  const loadSignals = useCallback(async () => {
    const currentRequest = ++requestId.current;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListLoading(true);
    setListError(null);
    try {
      const result = await listSignals({ page: 1, limit: 20, signal: controller.signal });
      if (!mounted.current || currentRequest !== requestId.current) return;
      setSignals(result.signals);
      setTotal(result.pagination.total);
      setSelectedSignal((current) => {
        if (current && !result.signals.some((signal) => signal.id === current.id)) {
          generationController.current?.abort();
          setGeneration(null);
          setGenerationError(null);
          setMutationError(null);
          setMutationUncertain(false);
          setEditingVariationId(null);
          setEditorContent("");
          return null;
        }
        return current;
      });
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      if (!mounted.current || currentRequest !== requestId.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        invalidateSession();
        return;
      }
      setListError("Unable to load your signals. Please try again.");
    } finally {
      if (currentRequest === requestId.current) {
        if (mounted.current) setListLoading(false);
        if (listController.current === controller) listController.current = null;
      }
    }
  }, [invalidateSession]);

  const loadGeneration = useCallback(async (signal: PublicSignal) => {
    const currentRequest = ++generationRequestId.current;
    generationController.current?.abort();
    const controller = new AbortController();
    generationController.current = controller;
    setGenerationLoading(true);
    setGenerationError(null);
    setGenerationOutcomeUncertain(false);
    try {
      const result = await getGeneration(signal.id, controller.signal);
      if (!mounted.current || currentRequest !== generationRequestId.current) return;
      setGeneration(result);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      if (!mounted.current || currentRequest !== generationRequestId.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        invalidateSession();
        return;
      }
      if (error instanceof ApiClientError && error.code === "GENERATION_NOT_FOUND") {
        setGeneration(null);
      } else if (error instanceof ApiClientError && error.code === "SIGNAL_NOT_FOUND") {
        setSelectedSignal(null);
        setGeneration(null);
        setGenerationError("This Signal is no longer available.");
      } else {
        setGenerationError("Unable to load drafts. Please try again.");
      }
    } finally {
      if (currentRequest === generationRequestId.current) {
        if (mounted.current) setGenerationLoading(false);
        if (generationController.current === controller) generationController.current = null;
      }
    }
  }, [invalidateSession]);

  const handleSelectSignal = useCallback((signal: PublicSignal) => {
    if (generationPending || mutationPending || editingVariationId !== null) return;
    setSelectedSignal(signal);
    setGeneration(null);
    setEditingVariationId(null);
    setEditorContent("");
    void loadGeneration(signal);
  }, [editingVariationId, generationPending, loadGeneration, mutationPending]);

  const handleGenerate = useCallback(async () => {
    if (!selectedSignal || generationPending || mutationPending) return;
    setGenerationPending(true);
    setGenerationError(null);
    setGenerationOutcomeUncertain(false);
    setMutationError(null);
    setMutationUncertain(false);
    try {
      const result = await createGeneration(selectedSignal.id);
      if (!mounted.current) return;
      setGeneration(result);
      refreshDraftLibrary();
    } catch (error: unknown) {
      if (!mounted.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        invalidateSession();
      } else if (
        error instanceof ApiClientError &&
        ["REQUEST_TIMEOUT", "NETWORK_ERROR", "AI_SERVICE_TIMEOUT", "AI_SERVICE_UNAVAILABLE"].includes(
          error.code,
        )
      ) {
        setGenerationOutcomeUncertain(true);
        setGenerationError("Generation may still be processing. Check for saved drafts before trying again.");
      } else if (error instanceof ApiClientError && error.code === "AI_GENERATION_REFUSED") {
        setGenerationError("The requested drafts could not be generated.");
      } else if (error instanceof ApiClientError && error.code === "GENERATION_RATE_LIMIT_EXCEEDED") {
        setGenerationError("Generation is temporarily limited. Please try again later.");
      } else {
        setGenerationError("Unable to generate drafts. Please try again.");
      }
    } finally {
      if (mounted.current) setGenerationPending(false);
    }
  }, [generationPending, invalidateSession, mutationPending, refreshDraftLibrary, selectedSignal]);

  const handleStartEditing = useCallback((variation: PublicDraft) => {
    if (mutationPending || editingVariationId !== null) return;
    setEditingVariationId(variation.id);
    setEditorContent(variation.content);
    setMutationError(null);
    setMutationUncertain(false);
  }, [editingVariationId, mutationPending]);

  const handleCancelEditing = useCallback(() => {
    if (mutationPending) return;
    setEditingVariationId(null);
    setEditorContent("");
    setMutationError(null);
    setMutationUncertain(false);
  }, [mutationPending]);

  const handleSaveEditing = useCallback(async () => {
    if (
      !selectedSignal ||
      !generation ||
      !editingVariationId ||
      mutationPending ||
      editorContent === generation.variations.find((variation) => variation.id === editingVariationId)?.content
    ) {
      return;
    }
    if (editorContent.trim().length < 100 || editorContent.trim().length > 3000) return;

    generationRequestId.current += 1;
    generationController.current?.abort();
    setMutationPending(true);
    setMutationError(null);
    setMutationUncertain(false);
    try {
      const result = await editGeneration(selectedSignal.id, editingVariationId, editorContent);
      if (!mounted.current) return;
      setGeneration(result);
      setEditingVariationId(null);
      setEditorContent("");
      refreshDraftLibrary();
    } catch (error: unknown) {
      if (!mounted.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        invalidateSession();
      } else if (
        error instanceof ApiClientError &&
        ["REQUEST_TIMEOUT", "NETWORK_ERROR"].includes(error.code)
      ) {
        setMutationUncertain(true);
        setMutationError("The edit may still be processing. Check for saved drafts before trying again.");
      } else if (error instanceof ApiClientError && error.code === "VALIDATION_ERROR") {
        setMutationError("Enter between 100 and 3000 trimmed characters.");
      } else if (error instanceof ApiClientError && error.code === "SIGNAL_NOT_FOUND") {
        setSelectedSignal(null);
        setGeneration(null);
        setEditingVariationId(null);
        setEditorContent("");
        setMutationError("This Signal is no longer available.");
      } else if (error instanceof ApiClientError && error.code === "GENERATION_NOT_FOUND") {
        setGeneration(null);
        setEditingVariationId(null);
        setEditorContent("");
        setMutationError("No drafts exist for this Signal.");
      } else if (error instanceof ApiClientError && error.code === "VARIATION_NOT_FOUND") {
        setMutationError("This draft is no longer available.");
      } else {
        setMutationError("Unable to save this edit. Please try again.");
      }
    } finally {
      if (mounted.current) setMutationPending(false);
    }
  }, [
    editingVariationId,
    editorContent,
    generation,
    invalidateSession,
    mutationPending,
    selectedSignal,
    refreshDraftLibrary,
  ]);

  const handleApprove = useCallback(async (variationId: string) => {
    if (!selectedSignal || !generation || mutationPending || editingVariationId !== null) return;

    generationRequestId.current += 1;
    generationController.current?.abort();
    setMutationPending(true);
    setMutationError(null);
    setMutationUncertain(false);
    try {
      const result = await approveGeneration(selectedSignal.id, variationId);
      if (!mounted.current) return;
      setGeneration(result);
      refreshDraftLibrary();
    } catch (error: unknown) {
      if (!mounted.current) return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        invalidateSession();
      } else if (
        error instanceof ApiClientError &&
        ["REQUEST_TIMEOUT", "NETWORK_ERROR"].includes(error.code)
      ) {
        setMutationUncertain(true);
        setMutationError("Approval may still be processing. Check for saved drafts before trying again.");
      } else if (error instanceof ApiClientError && error.code === "SIGNAL_NOT_FOUND") {
        setSelectedSignal(null);
        setGeneration(null);
        setMutationError("This Signal is no longer available.");
      } else if (error instanceof ApiClientError && error.code === "GENERATION_NOT_FOUND") {
        setGeneration(null);
        setMutationError("No drafts exist for this Signal.");
      } else if (error instanceof ApiClientError && error.code === "VARIATION_NOT_FOUND") {
        setMutationError("This draft is no longer available.");
      } else {
        setMutationError("Unable to approve this draft. Please try again.");
      }
    } finally {
      if (mounted.current) setMutationPending(false);
    }
  }, [editingVariationId, generation, invalidateSession, mutationPending, refreshDraftLibrary, selectedSignal]);

  const findSignalAndOpenDraft = useCallback(async (draft: PublicDraftLibraryItem) => {
    if (mutationPending || editingVariationId !== null) return;
    const controller = new AbortController();
    try {
      let page = 1;
      let found: PublicSignal | undefined;
      while (!found) {
        const result = await listSignals({ page, limit: 50, signal: controller.signal });
        found = result.signals.find((signal) => signal.id === draft.signalId);
        if (found || page >= result.pagination.totalPages) break;
        page += 1;
      }
      if (!found) {
        setDraftsError("This Signal is no longer available.");
        return;
      }
      setActiveTab("create");
      handleSelectSignal(found);
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        invalidateSession();
        return;
      }
      setDraftsError("Unable to open this draft. Please try again.");
    }
  }, [editingVariationId, handleSelectSignal, invalidateSession, mutationPending]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSignals(), 0);
    return () => window.clearTimeout(timer);
  }, [authStatus, loadSignals]);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      draftController.current?.abort();
      draftQueryKey.current = "";
      const timer = window.setTimeout(() => {
        setDraftLibrary(null);
        setDraftsError(null);
        setDraftPage(1);
        setSelectedSignal(null);
        setGeneration(null);
        setEditingVariationId(null);
        setEditorContent("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      void loadDraftLibrary(draftPage, draftFilter);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authStatus, draftFilter, draftPage, loadDraftLibrary]);

  const handleCreate = useCallback(async (payload: SignalPayload) => {
    setCreatePending(true);
    try {
      const signal = await createSignal(payload);
      if (!mounted.current) return;
      setSignals((current) => [signal, ...current].slice(0, 20));
      if (total !== null) setTotal((current) => (current === null ? null : current + 1));
      else void loadSignals();
      return true;
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
        invalidateSession();
      }
      throw error;
    } finally {
      if (mounted.current) setCreatePending(false);
    }
  }, [invalidateSession, loadSignals, total]);

  return (
    <>
      <WorkspaceOverview total={total} approved={draftLibrary?.summary.approved ?? null} />
      <WorkspaceNavigation
        activeTab={activeTab}
        onChange={setActiveTab}
        disabled={mutationPending || editingVariationId !== null}
      />
      {activeTab === "create" && (
        <>
          <NewSignalForm onCreate={handleCreate} pending={createPending || listLoading} />
          <RecentSignals
        signals={signals}
        loading={listLoading}
        error={listError}
        total={total}
        onRetry={() => void loadSignals()}
        selectedSignalId={selectedSignal?.id ?? null}
        onSelectSignal={handleSelectSignal}
         selectionDisabled={generationPending || mutationPending || editingVariationId !== null}
          />
          <DraftStudio
        signalTopic={selectedSignal?.topic ?? null}
        generation={generation}
        loading={generationLoading}
        generating={generationPending}
        mutationPending={mutationPending}
        error={generationError ?? (mutationUncertain ? mutationError : null)}
        uncertain={generationOutcomeUncertain || mutationUncertain}
        mutationError={mutationError}
        editingVariationId={editingVariationId}
        editorContent={editorContent}
        onEditorContentChange={setEditorContent}
        onStartEditing={handleStartEditing}
        onCancelEditing={handleCancelEditing}
        onSaveEditing={() => void handleSaveEditing()}
        onApprove={(variationId) => void handleApprove(variationId)}
        onGenerate={() => void handleGenerate()}
        onRetry={() => {
          if (selectedSignal) {
            setMutationError(null);
            setMutationUncertain(false);
            void loadGeneration(selectedSignal);
          }
        }}
          />
        </>
      )}
      {activeTab === "drafts" && (
        <DraftsView
          data={draftLibrary}
          filter={draftFilter}
          loading={draftsLoading}
          error={draftsError}
          onFilterChange={(filter) => {
            setDraftFilter(filter);
            setDraftPage(1);
            draftQueryKey.current = "";
          }}
          onPageChange={setDraftPage}
          onRetry={() => {
            draftQueryKey.current = "";
            void loadDraftLibrary(draftPage, draftFilter);
          }}
          onOpen={(draft) => void findSignalAndOpenDraft(draft)}
        />
      )}
      {activeTab === "calendar" && (
        <p className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-sm text-slate-500">
          Calendar is coming soon.
        </p>
      )}
    </>
  );
}
