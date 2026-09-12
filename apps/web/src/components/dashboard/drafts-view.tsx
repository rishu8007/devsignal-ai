import type { DraftStatus } from "@/lib/api/generation-client";
import type { DraftLibraryResponse, PublicDraftLibraryItem } from "@/lib/api/draft-client";

type DraftFilter = "all" | DraftStatus;

interface DraftsViewProps {
  data: DraftLibraryResponse | null;
  filter: DraftFilter;
  loading: boolean;
  error: string | null;
  onFilterChange: (filter: DraftFilter) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onOpen: (draft: PublicDraftLibraryItem) => void;
}

const labels = {
  technical_depth: "Technical depth",
  learning_story: "Learning story",
  professional_impact: "Professional impact",
} as const;

export function DraftsView({
  data,
  filter,
  loading,
  error,
  onFilterChange,
  onPageChange,
  onRetry,
  onOpen,
}: DraftsViewProps) {
  return (
    <section aria-labelledby="draft-library-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">
            Content library
          </p>
          <h2 id="draft-library-heading" className="mt-2 text-2xl font-semibold text-slate-900">
            Drafts
          </h2>
        </div>
        <div className="flex gap-2" role="group" aria-label="Draft status filter">
          {(["all", "draft", "approved"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onFilterChange(option)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                filter === option
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-300 bg-white text-slate-600"
              }`}
            >
              {option === "all" ? "All" : option === "draft" ? "Draft" : "Approved"}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="mt-5 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500" role="status">
          Loading drafts...
        </p>
      )}
      {!loading && error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">
            Retry
          </button>
        </div>
      )}
      {!loading && !error && data && data.drafts.length === 0 && (
        <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-sm text-slate-500">
          No {filter === "all" ? "" : `${filter} `}drafts found.
        </p>
      )}
      {!loading && !error && data && data.drafts.length > 0 && (
        <>
          <div className="mt-5 grid gap-4">
            {data.drafts.map((draft) => <DraftLibraryCard key={draft.id} draft={draft} onOpen={onOpen} />)}
          </div>
          <div className="mt-5 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Page {data.pagination.page} of {data.pagination.totalPages}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => onPageChange(data.pagination.page - 1)} disabled={data.pagination.page <= 1} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50">
                Previous
              </button>
              <button type="button" onClick={() => onPageChange(data.pagination.page + 1)} disabled={data.pagination.page >= data.pagination.totalPages} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50">
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function DraftLibraryCard({ draft, onOpen }: { draft: PublicDraftLibraryItem; onOpen: (draft: PublicDraftLibraryItem) => void }) {
  const statusLabel = draft.status === "approved" ? "Approved" : "Draft";
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{draft.topic}</h3>
          <p className="mt-1 text-sm font-medium text-indigo-700">{labels[draft.angle]}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{statusLabel}</span>
      </div>
      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{draft.content}</p>
      <p className="mt-4 text-xs text-slate-500">
        Generation updated: {formatDate(draft.generationUpdatedAt)}
      </p>
      <button type="button" onClick={() => onOpen(draft)} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
        Open in Draft Studio
      </button>
    </article>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
