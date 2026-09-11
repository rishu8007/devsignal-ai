"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { createSignal, listSignals, type PublicSignal, type SignalPayload } from "@/lib/api/signal-client";
import { useAuth } from "@/components/auth/auth-provider";
import { DraftStudio } from "@/components/dashboard/draft-studio";
import { NewSignalForm } from "@/components/dashboard/new-signal-form";
import { RecentSignals } from "@/components/dashboard/recent-signals";
import { WorkspaceNavigation } from "@/components/dashboard/workspace-navigation";
import { WorkspaceOverview } from "@/components/dashboard/workspace-overview";

export function DashboardWorkspace() {
  const { invalidateSession } = useAuth();
  const [signals, setSignals] = useState<PublicSignal[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const requestId = useRef(0);
  const listController = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listController.current?.abort();
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

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSignals(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSignals]);

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
      />
      <DraftStudio />
    </>
  );
}
