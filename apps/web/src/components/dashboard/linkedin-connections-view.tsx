"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { connectLinkedIn, disconnectLinkedIn, getLinkedInStatus, requestLinkedInPostingConsent, type LinkedInStatus } from "@/lib/api/linkedin-client";
import { listLinkedInPublications, type LinkedInPublication } from "@/lib/api/linkedin-publication-client";

export function LinkedInConnectionsView({ active, onNavigate }: { active: boolean; onNavigate?: (tab: "drafts" | "calendar") => void }) {
  const [status, setStatus] = useState<LinkedInStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<LinkedInPublication[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await getLinkedInStatus();
      setStatus(nextStatus);
      if (nextStatus.publishingEnabled) setHistory(await listLinkedInPublications());
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "The connection status could not be loaded.");
    } finally {
      setLoading(false);
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

  async function requestPostingConsent() {
    setPending(true);
    try {
      const result = await requestLinkedInPostingConsent();
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Posting permission could not be requested.");
      setPending(false);
    }
  }

  if (!active) return null;
  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">Connections</h2>
      <p className="mt-1 text-sm text-slate-600">Connections manage account access only. They never create, approve, schedule, or publish content.</p>
      <article className="mt-5 rounded-xl border border-slate-200 p-5" aria-labelledby="linkedin-connection-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 id="linkedin-connection-heading" className="text-lg font-semibold text-slate-900">LinkedIn</h3><p className="mt-1 text-sm text-slate-600">Identity and optional posting permission.</p></div>
          {loading ? <span className="text-sm text-slate-500" role="status">Checking connection…</span> : status?.connected ? <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.status === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{status.status === "connected" ? "Connected" : "Reconnect required"}</span> : status?.status === "not_configured" ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Unavailable</span> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Disconnected</span>}
        </div>
      {error && <p className="mt-4 rounded bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
      {!loading && status?.status === "not_configured" ? (
        <p className="mt-5 rounded bg-slate-50 p-3 text-sm text-slate-600">LinkedIn is unavailable because this environment has not configured the connection integration. No account changes were made.</p>
      ) : status?.connected ? (
        <div className="mt-5 space-y-3">
          <p className="font-medium text-slate-900">{status.identity?.displayName ?? "LinkedIn member"}</p>
          <p className="text-sm text-slate-600">Status: {status.status === "connected" ? "Connected" : "Reconnect required"}</p>
          <p className="text-sm text-slate-600">Identity permission: granted. Posting permission: {status.capabilities?.posting ? "granted" : "not granted"}.</p>
          {status.expiresAt && <p className="text-sm text-slate-600">Access expires: {new Date(status.expiresAt).toLocaleString()}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => void connect()} disabled={pending} className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Reconnect</button>
            {!status.capabilities?.posting && <button type="button" onClick={() => void requestPostingConsent()} disabled={pending} className="rounded border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 disabled:opacity-50">Enable posting</button>}
            <button type="button" onClick={() => void disconnect()} disabled={pending} className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Disconnect</button>
          </div>
        </div>
      ) : !loading ? (
        <button type="button" onClick={() => void connect()} disabled={pending} className="mt-5 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Connect LinkedIn</button>
      ) : null}
      {status?.enabled && history.length > 0 && (
        <div className="mt-8 border-t border-slate-200 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-900">Publication history</h3><div className="flex gap-3 text-sm"><button type="button" onClick={() => onNavigate?.("drafts")} className="text-indigo-700 underline">Open drafts</button><button type="button" onClick={() => onNavigate?.("calendar")} className="text-indigo-700 underline">Open scheduled items</button></div></div>
          <ul className="mt-3 space-y-3">
            {history.map((publication) => (
              <li key={publication.id} className="rounded border border-slate-200 p-3 text-sm">
                <p className="font-medium text-slate-800">{publication.status === "published" ? "Published" : publication.status === "uncertain" ? "Uncertain" : "Not published"}</p>
                <p className="mt-1 line-clamp-2 text-slate-600">{publication.text}</p>
                {publication.postUrl && <a className="mt-1 inline-block text-indigo-700 underline" href={publication.postUrl} target="_blank" rel="noreferrer">View post</a>}
                {publication.errorMessage && <p className="mt-1 text-amber-700">{publication.errorMessage}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      </article>
    </section>
  );
}
