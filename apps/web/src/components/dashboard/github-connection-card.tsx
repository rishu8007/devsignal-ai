"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import {
  connectGithub,
  disconnectGithub,
  getGithubStatus,
  listGithubRepositories,
  selectGithubRepositories,
  type GithubRepository,
  type GithubStatus,
} from "@/lib/api/github-client";
import { GithubWorkView } from "./github-work-view";

export function GithubConnectionCard({ active }: { active: boolean }) {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [availableRepositories, setAvailableRepositories] = useState<GithubRepository[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [work, setWork] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      try {
        const nextStatus = await getGithubStatus();
        if (cancelled) return;
        setStatus(nextStatus);
        if (nextStatus.status === "connected") {
          const repositories = await listGithubRepositories();
          if (!cancelled) setAvailableRepositories(repositories);
        } else {
          setAvailableRepositories([]);
        }
      } catch (value: unknown) {
        if (!cancelled) {
          setError(value instanceof ApiClientError ? value.message : "GitHub connection status could not be loaded.");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active) return null;

  const runConnect = async () => {
    setPending(true);
    try {
      window.location.assign((await connectGithub()).authorizationUrl);
    } catch (value: unknown) {
      setError(value instanceof ApiClientError ? value.message : "GitHub could not be connected.");
      setPending(false);
    }
  };

  const disconnect = async () => {
    setPending(true);
    try {
      await disconnectGithub();
      setStatus(await getGithubStatus());
      setAvailableRepositories([]);
    } catch (value: unknown) {
      setError(value instanceof ApiClientError ? value.message : "GitHub could not be disconnected.");
    } finally {
      setPending(false);
    }
  };

  const saveSelection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const repositoryIds = Array.from(
      event.currentTarget.querySelectorAll<HTMLInputElement>("input:checked"),
      (input) => Number(input.value),
    );
    setPending(true);
    setError(null);
    try {
      await selectGithubRepositories(repositoryIds);
      setStatus(await getGithubStatus());
      setAvailableRepositories(await listGithubRepositories());
    } catch (value: unknown) {
      setError(value instanceof ApiClientError ? value.message : "Repository selection failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <article className="mt-5 rounded-xl border border-slate-200 p-5" aria-labelledby="github-connection-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="github-connection-heading" className="text-lg font-semibold text-slate-900">GitHub</h3>
            <p className="mt-1 text-sm text-slate-600">Select repositories for private, on-demand work tracking. Public documentation import remains separate in Knowledge.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {status?.status === "connected"
              ? "Connected"
              : status?.status === "revoked"
                ? "Reconnect required"
                : status?.status === "not_configured"
                  ? "Unavailable"
                  : "Disconnected"}
          </span>
        </div>
        {error && <p className="mt-3 rounded bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
        {status?.status === "not_configured" ? (
          <p className="mt-4 rounded bg-slate-50 p-3 text-sm text-slate-600">GitHub account connection is unavailable because this environment is not configured.</p>
        ) : status?.status !== "connected" ? (
          <button type="button" onClick={() => void runConnect()} disabled={pending || !status} className="mt-4 rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {status?.status === "revoked" ? "Reconnect GitHub" : "Connect GitHub"}
          </button>
        ) : (
          <>
            <p className="mt-4 text-sm text-slate-700">Connected as <strong>{status.identity?.login}</strong>. Tokens stay server-side.</p>
            {status.sync?.nextEligibleAt && <p className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-800">GitHub sync is rate-limited until {new Date(status.sync.nextEligibleAt).toLocaleString()}.</p>}
            {status.sync?.lastError && <p className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-800">{status.sync.lastError}</p>}
            <form onSubmit={(event) => void saveSelection(event)} className="mt-4 space-y-2">
              <p className="text-sm font-semibold text-slate-800">Authorized repositories</p>
              {availableRepositories.length === 0
                ? <p className="text-sm text-slate-600">No repositories are available to this GitHub App installation.</p>
                : availableRepositories.map((repository) => (
                  <label key={repository.id} className="block text-sm text-slate-700">
                    <input type="checkbox" value={repository.id} defaultChecked={repository.selected} className="mr-2" />
                    {repository.fullName}{repository.private ? " (private)" : ""}
                  </label>
                ))}
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="submit" disabled={pending} className="rounded border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-700">Save repositories</button>
                <button type="button" onClick={() => void runConnect()} disabled={pending} className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Reconnect</button>
                <button type="button" onClick={() => void disconnect()} disabled={pending} className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Disconnect</button>
                <button type="button" onClick={() => setWork((value) => !value)} className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">{work ? "Hide work" : "Open work activity"}</button>
              </div>
            </form>
          </>
        )}
      </article>
      <GithubWorkView active={active && work} repositories={status?.repositories ?? []} />
    </>
  );
}
