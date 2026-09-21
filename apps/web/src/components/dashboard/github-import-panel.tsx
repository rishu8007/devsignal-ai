"use client";

import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { importGithubFile, previewGithubRepository, readGithubPreviewFile, type GithubPreview, type GithubPreviewFile } from "@/lib/api/knowledge-source-client";

export function GithubImportPanel({ active, disabled, onImported, onClose }: {
  active: boolean;
  disabled: boolean;
  onImported: () => void;
  onClose: () => void;
}) {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [preview, setPreview] = useState<GithubPreview | null>(null);
  const [file, setFile] = useState<GithubPreviewFile | null>(null);
  const [title, setTitle] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  if (!active) return null;
  const run = async (operation: () => Promise<void>) => {
    if (loading) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setLoading(true); setError(null);
    try { await operation(); } catch (caught: unknown) {
      if (caught instanceof ApiClientError && caught.code === "REQUEST_ABORTED") return;
      setError(caught instanceof Error ? caught.message : "GitHub import failed.");
    } finally { setLoading(false); }
  };
  return (
    <section className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4" aria-labelledby="github-import-heading">
      <div className="flex items-start justify-between gap-3">
        <div><h4 id="github-import-heading" className="font-semibold text-slate-900">Import from GitHub</h4>
          <p className="mt-1 text-xs text-slate-600">Public repositories only. Importing saves a note; it does not index it.</p></div>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-600">Cancel</button>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <input value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/owner/repository" disabled={loading || disabled} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm" />
        <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="Branch (optional)" disabled={loading || disabled} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm" />
      </div>
      {!preview && <button type="button" disabled={loading || disabled || !repositoryUrl.trim()} onClick={() => void run(async () => setPreview(await previewGithubRepository(repositoryUrl.trim(), branch.trim() || undefined, controller.current?.signal)))} className="mt-3 rounded bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? "Loading repository..." : "Preview files"}</button>}
      {preview && <p className="mt-3 text-xs text-slate-600">Pinned to commit <code>{preview.commitSha.slice(0, 12)}</code> on <strong>{preview.branch}</strong>.</p>}
      {preview?.skipped.length ? <details className="mt-2 text-xs text-slate-600"><summary>Skipped files: {preview.skipped.length}</summary><ul className="mt-1 list-disc pl-5">{preview.skipped.map((item) => <li key={item.path}>{item.path}: {item.reason}</li>)}</ul></details> : null}
      {preview && <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="max-h-56 overflow-auto rounded border border-indigo-100 bg-white p-2">
          {preview.files.length === 0 ? <p className="p-2 text-sm text-slate-600">No eligible Markdown or text files were found.</p> : preview.files.map((item) => <button type="button" key={item.path} onClick={() => void run(async () => { setSelectedPath(item.path); setFile(await readGithubPreviewFile(preview.previewToken, item.path, controller.current?.signal)); setTitle(item.path.split("/").pop()?.replace(/\.(md|markdown|txt)$/i, "") ?? "Imported documentation"); })} className={`block w-full truncate px-2 py-1 text-left text-sm ${selectedPath === item.path ? "bg-indigo-100 font-semibold" : "text-slate-700"}`}>{item.path}</button>)}
        </div>
        <div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-indigo-100 bg-white p-3 text-xs text-slate-700">{file?.content ?? "Select a file to read its pinned contents."}</pre>
          {file && <><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm" aria-label="Imported note title" /><button type="button" disabled={loading || disabled || title.trim().length < 1} onClick={() => void run(async () => { await importGithubFile(preview.previewToken, file.path, title.trim()); onImported(); onClose(); })} className="mt-2 rounded bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? "Saving..." : "Save reviewed file"}</button></>}
        </div>
      </div>}
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
    </section>
  );
}
