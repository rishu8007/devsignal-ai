"use client";

import type { PublicSignal } from "@/lib/api/signal-client";

interface RecentSignalsProps {
  signals: PublicSignal[];
  loading: boolean;
  error: string | null;
  total: number | null;
  onRetry: () => void;
  selectedSignalId: string | null;
  onSelectSignal: (signal: PublicSignal) => void;
  selectionDisabled: boolean;
}

export function RecentSignals({
  signals,
  loading,
  error,
  total,
  onRetry,
  selectedSignalId,
  onSelectSignal,
  selectionDisabled,
}: RecentSignalsProps) {
  return (
    <section aria-labelledby="recent-signals-heading" className="mt-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">
            Saved work
          </p>
          <h2 id="recent-signals-heading" className="mt-2 text-xl font-semibold text-slate-900">
            Recent signals
          </h2>
        </div>
        {total !== null && total > signals.length && (
          <p className="text-sm text-slate-500">Showing {signals.length} of {total}</p>
        )}
      </div>

      {loading && (
        <p className="mt-4 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500" role="status">
          Loading your signals...
        </p>
      )}
      {!loading && error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">
            Retry
          </button>
        </div>
      )}
      {!loading && !error && signals.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-sm text-slate-500">
          No signals saved yet. Capture your next piece of progress above.
        </p>
      )}
      {!loading && !error && signals.length > 0 && (
        <ul className="mt-4 grid gap-4">
          {signals.map((signal) => (
            <li key={signal.id} className={`min-w-0 rounded-xl border bg-white p-5 shadow-sm ${selectedSignalId === signal.id ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">{signal.primaryAudience}</span>
                <span className="rounded-full bg-teal-50 px-2.5 py-1 text-teal-700">{signal.contentType}</span>
                <time dateTime={signal.createdAt}>{formatDate(signal.createdAt)}</time>
              </div>
              <h3 className="mt-3 break-words text-lg font-semibold text-slate-900">{signal.topic}</h3>
              <p className="mt-2 break-words text-sm leading-6 text-slate-600">{signal.notes}</p>
              <button
                type="button"
                onClick={() => onSelectSignal(signal)}
                disabled={selectionDisabled}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selectedSignalId === signal.id ? "Selected" : "View drafts"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}
