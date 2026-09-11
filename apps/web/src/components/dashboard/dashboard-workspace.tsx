"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import {
  createGeneration,
  getGeneration,
  type PublicGeneration,
} from "@/lib/api/generation-client";
import { createSignal, listSignals, type PublicSignal, type SignalPayload } from "@/lib/api/signal-client";
import { useAuth } from "@/components/auth/auth-provider";
import { DraftStudio } from "@/components/dashboard/draft-studio";
import { NewSignalForm } from "@/components/dashboard/new-signal-form";
import { RecentSignals } from "@/components/dashboard/recent-signals";
import { WorkspaceNavigation } from "@/components/dashboard/workspace-navigation";
import { WorkspaceOverview } from "@/components/dashboard/workspace-overview";

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
  const [generationOutcomeUncertain, setGenerationOutcomeUncertain] = useState(false);
  const requestId = useRef(0);
  const listController = useRef<AbortController | null>(null);
  const generationRequestId = useRef(0);
  const generationController = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listController.current?.abort();
      generationController.current?.abort();
    };
  }, []);

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
    if (generationPending) return;
    setSelectedSignal(signal);
    setGeneration(null);
    void loadGeneration(signal);
  }, [generationPending, loadGeneration]);

  const handleGenerate = useCallback(async () => {
    if (!selectedSignal || generationPending) return;
    setGenerationPending(true);
    setGenerationError(null);
    setGenerationOutcomeUncertain(false);
    try {
      const result = await createGeneration(selectedSignal.id);
      if (!mounted.current) return;
      setGeneration(result);
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
  }, [generationPending, invalidateSession, selectedSignal]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSignals(), 0);
    return () => window.clearTimeout(timer);
  }, [authStatus, loadSignals]);

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
      <WorkspaceOverview total={total} />
      <WorkspaceNavigation />
      <NewSignalForm onCreate={handleCreate} pending={createPending || listLoading} />
      <RecentSignals
        signals={signals}
        loading={listLoading}
        error={listError}
        total={total}
        onRetry={() => void loadSignals()}
        selectedSignalId={selectedSignal?.id ?? null}
        onSelectSignal={handleSelectSignal}
        selectionDisabled={generationPending}
      />
      <DraftStudio
        signalTopic={selectedSignal?.topic ?? null}
        generation={generation}
        loading={generationLoading}
        generating={generationPending}
        error={generationError}
        uncertain={generationOutcomeUncertain}
        onGenerate={() => void handleGenerate()}
        onRetry={() => selectedSignal && void loadGeneration(selectedSignal)}
      />
    </>
  );
}
