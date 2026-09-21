"use client";

import { useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { confirmLinkedInPublication, createLinkedInPreview, type LinkedInPublication } from "@/lib/api/linkedin-publication-client";

export function LinkedInPublishAction({ signalId, variationId }: { signalId: string; variationId: string }) {
  const [preview, setPreview] = useState<LinkedInPublication | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  return (
    <div className="mt-3">
      {!preview && <button type="button" onClick={() => void showPreview()} disabled={pending} className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50">Publish to LinkedIn</button>}
      {preview?.status === "pending" && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-left">
          <p className="font-semibold text-slate-900">Confirm LinkedIn publication</p>
          <p className="mt-2 text-sm text-slate-600">Account: {preview.account.displayName ?? preview.account.memberId}</p>
          <p className="text-sm text-slate-600">Visibility: {preview.visibility}</p>
          <p className="text-xs text-slate-500">Draft version: {preview.draftContentHash}</p>
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-sm text-slate-800">{preview.text}</pre>
          <div className="mt-3 flex gap-3">
            <button type="button" onClick={() => void publish()} disabled={pending} className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm and publish</button>
            <button type="button" onClick={() => setPreview(null)} disabled={pending} className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
