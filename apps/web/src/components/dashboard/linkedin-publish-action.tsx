"use client";

import { useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { cancelLinkedInPublication, confirmLinkedInPublication, createLinkedInPreview, rescheduleLinkedInPublication, scheduleLinkedInPublication, type LinkedInPublication } from "@/lib/api/linkedin-publication-client";

export function LinkedInPublishAction({ signalId, variationId }: { signalId: string; variationId: string }) {
  const [preview, setPreview] = useState<LinkedInPublication | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleTime, setScheduleTime] = useState("");
  const [disambiguation, setDisambiguation] = useState<"earlier" | "later">("earlier");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const resolvedUtc = scheduleTime ? new Date(`${scheduleTime}:00`).toISOString() : null;

  async function showPreview() {
    setPending(true);
    setError(null);
    try {
      setPreview(await createLinkedInPreview(signalId, variationId));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "A LinkedIn preview could not be created.");
    } finally {
      setPending(false);
    }
  }

  async function publish() {
    if (!preview) return;
    setPending(true);
    setError(null);
    try {
      setPreview(await confirmLinkedInPublication(preview.id));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "The LinkedIn publication could not be completed.");
    } finally {
      setPending(false);
    }

  }

  async function schedule() {
    if (!preview || !scheduleTime) return;
    setPending(true);
    setError(null);
    try {
      setPreview(await scheduleLinkedInPublication({ previewId: preview.id, localDateTime: scheduleTime, timezone, disambiguation }));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "The LinkedIn publication could not be scheduled.");
    } finally {
      setPending(false);
    }
  }

  async function cancelSchedule() {
    if (!preview) return;
    setPending(true);
    try {
      setPreview(await cancelLinkedInPublication(preview.id, preview.scheduleRevision));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "The scheduled publication could not be cancelled.");
    } finally {
      setPending(false);
    }
  }

  async function reschedule() {
    if (!preview || !scheduleTime) return;
    setPending(true);
    try {
      setPreview(await rescheduleLinkedInPublication({ previewId: preview.id, expectedRevision: preview.scheduleRevision, localDateTime: scheduleTime, timezone, disambiguation }));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "The scheduled publication could not be rescheduled.");
    } finally {
      setPending(false);
    }
  }

  if (preview?.status === "published") {
    return (
      <p className="mt-3 text-sm text-teal-700">
        Published to LinkedIn{preview.postUrl ? <>: <a className="underline" href={preview.postUrl} target="_blank" rel="noreferrer">View post</a></> : "."}
      </p>
    );
  }
  if (preview?.status === "uncertain") {
    return <p className="mt-3 text-sm text-amber-700">Publication status is uncertain. Check LinkedIn before taking further action.</p>;
  }
  if (preview && ["rejected", "blocked", "missed", "cancelled"].includes(preview.status)) {
    return <p className="mt-3 text-sm text-amber-700">LinkedIn publication {preview.status}. {preview.errorMessage ?? "Create a fresh preview if you want to try again."}</p>;
  }
  if (preview?.status === "scheduled") {
    return (
      <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-left">
        <p className="font-semibold text-slate-900">Automatic publishing scheduled</p>
        <p className="mt-1 text-sm text-slate-600">{preview.scheduledAt ? new Date(preview.scheduledAt).toLocaleString() : "Time unavailable"} ({preview.scheduledTimezone})</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm text-slate-700">Reschedule ({timezone})<input type="datetime-local" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1" /></label>
          {resolvedUtc && <p className="basis-full text-xs text-slate-600">This resolves to {resolvedUtc} UTC. The server rejects nonexistent times and requires a choice for repeated daylight-saving times.</p>}
          <button type="button" onClick={() => void reschedule()} disabled={pending || !scheduleTime} className="rounded border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50">Confirm reschedule</button>
          <button type="button" onClick={() => void cancelSchedule()} disabled={pending} className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel scheduled publication</button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3">
      {!preview && <div className="flex flex-wrap gap-3"><button type="button" onClick={() => void showPreview()} disabled={pending} className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50">Publish to LinkedIn</button><button type="button" onClick={() => void showPreview()} disabled={pending} className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50">Schedule to LinkedIn</button></div>}
      {preview?.status === "pending" && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-left">
          <p className="font-semibold text-slate-900">Confirm LinkedIn publication</p>
          <p className="mt-2 text-sm text-slate-600">Account: {preview.account.displayName ?? preview.account.memberId}</p>
          <p className="text-sm text-slate-600">Visibility: {preview.visibility}</p>
          <p className="text-xs text-slate-500">Draft version: {preview.draftContentHash}</p>
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-sm text-slate-800">{preview.text}</pre>
          <div className="mt-3 flex gap-3">
            <button type="button" onClick={() => void publish()} disabled={pending} className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm and publish</button>
            <label className="text-sm text-slate-700">Schedule ({timezone})<input type="datetime-local" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1" /></label>
            {resolvedUtc && <p className="basis-full text-xs text-slate-600">This resolves to {resolvedUtc} UTC. The server rejects nonexistent times and requires a choice for repeated daylight-saving times.</p>}
            <select value={disambiguation} onChange={(event) => setDisambiguation(event.target.value as "earlier" | "later")} className="self-end rounded border border-slate-300 px-2 py-1 text-sm"><option value="earlier">Earlier if repeated</option><option value="later">Later if repeated</option></select>
            <button type="button" onClick={() => void schedule()} disabled={pending || !scheduleTime} className="self-end rounded border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50">Confirm schedule</button>
            <button type="button" onClick={() => setPreview(null)} disabled={pending} className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
