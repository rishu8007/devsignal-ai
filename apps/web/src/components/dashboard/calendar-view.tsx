import type { PublicCalendarItem } from "@/lib/api/calendar-client";
import { CopyDraftButton } from "@/components/dashboard/copy-draft-button";

const labels = {
  technical_depth: "Technical depth",
  learning_story: "Learning story",
  professional_impact: "Professional impact",
} as const;

export function CalendarView({
  month,
  data,
  loading,
  error,
  onPrevious,
  onNext,
  onToday,
  onPageChange,
  onRetry,
  onOpen,
}: {
  month: Date;
  data: { items: PublicCalendarItem[]; pagination: { page: number; totalPages: number } } | null;
  loading: boolean;
  error: string | null;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onOpen: (item: PublicCalendarItem) => void;
}) {
  return (
    <section aria-labelledby="calendar-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">
            Manual publishing plan
          </p>
          <h2 id="calendar-heading" className="mt-2 text-2xl font-semibold text-slate-900">
            {new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(month)}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onPrevious} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600">Previous month</button>
          <button type="button" onClick={onToday} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600">Today</button>
          <button type="button" onClick={onNext} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600">Next month</button>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-500">
        Scheduled dates are reminders for manual publishing. Nothing is published automatically.
      </p>
      {loading && <p className="mt-5 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500" role="status">Loading calendar...</p>}
      {!loading && error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">Retry</button>
        </div>
      )}
      {!loading && !error && data && data.items.length === 0 && (
        <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-sm text-slate-500">
          No approved drafts are planned for this month.
        </p>
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <>
          <div className="mt-5 grid gap-4">
            {data.items.map((item) => (
              <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{item.topic}</h3>
                    <p className="mt-1 text-sm font-medium text-indigo-700">{labels[item.angle]}</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Approved</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-700">
                  Planned: {formatLocalDate(item.scheduledFor)}
                </p>
                <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{item.content}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={() => onOpen(item)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Open in Draft Studio</button>
                  <CopyDraftButton content={item.content} />
                </div>
              </article>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between">
            <p className="text-sm text-slate-500">Page {data.pagination.page} of {data.pagination.totalPages}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => onPageChange(data.pagination.page - 1)} disabled={data.pagination.page <= 1} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
              <button type="button" onClick={() => onPageChange(data.pagination.page + 1)} disabled={data.pagination.page >= data.pagination.totalPages} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function formatLocalDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
