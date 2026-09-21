"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { connectLinkedIn, disconnectLinkedIn, getLinkedInStatus, type LinkedInStatus } from "@/lib/api/linkedin-client";

export function LinkedInConnectionsView({ active }: { active: boolean }) {
  const [status, setStatus] = useState<LinkedInStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await getLinkedInStatus());
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "The connection status could not be loaded.");
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const run = async () => {
      await load();
    };
    void run();
  }, [active, load]);

  async function connect() {
    setPending(true);
    try {
      const result = await connectLinkedIn();
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "LinkedIn could not be connected.");
      setPending(false);
    }
  }

  async function disconnect() {
    setPending(true);
    try {
      await disconnectLinkedIn();
      await load();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "LinkedIn could not be disconnected.");
    } finally {
      setPending(false);
    }
  }

  if (!active) return null;
  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">Connections</h2>
      <p className="mt-1 text-sm text-slate-600">Connect an account for future publishing integrations. Connecting never creates or publishes content.</p>
      {error && <p className="mt-4 rounded bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {status?.status === "not_configured" ? (
        <p className="mt-5 text-sm text-slate-600">LinkedIn is not configured for this environment.</p>
      ) : status?.connected ? (
        <div className="mt-5 space-y-3">
          <p className="font-medium text-slate-900">{status.identity?.displayName ?? "LinkedIn member"}</p>
          <p className="text-sm text-slate-600">Status: {status.status === "connected" ? "Connected" : "Reconnect required"}</p>
          <p className="text-sm text-slate-600">Identity permission: granted. Posting permission: {status.capabilities?.posting ? "granted" : "unavailable"}.</p>
          {status.expiresAt && <p className="text-sm text-slate-600">Access expires: {new Date(status.expiresAt).toLocaleString()}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => void connect()} disabled={pending} className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Reconnect</button>
            <button type="button" onClick={() => void disconnect()} disabled={pending} className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Disconnect</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => void connect()} disabled={pending} className="mt-5 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Connect LinkedIn</button>
      )}
    </section>
  );
}
