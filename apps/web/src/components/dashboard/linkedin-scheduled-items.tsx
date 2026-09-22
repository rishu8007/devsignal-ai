"use client";

import { useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { listLinkedInPublications, type LinkedInPublication } from "@/lib/api/linkedin-publication-client";

export function LinkedInScheduledItems({ active }: { active: boolean }) {
  const [items, setItems] = useState<LinkedInPublication[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    void listLinkedInPublications()
      .then((publications) => setItems(publications.filter((item) => item.status === "scheduled" || item.status === "missed" || item.status === "blocked")))
      .catch((cause) => setError(cause instanceof ApiClientError ? cause.message : "Scheduled LinkedIn items could not be loaded."));
  }, [active]);

  if (!active || (!error && items.length === 0)) return null;
  return (
    <section className="mt-8 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-700">Automatic publishing</p>
      <h2 className="mt-2 text-xl font-semibold text-slate-900">LinkedIn schedule</h2>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 grid gap-3">
        {items.map((item) => (
          <article key={item.id} className="rounded-lg border border-indigo-100 bg-white p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">{item.status}</span>
              <span className="text-sm text-slate-600">{item.scheduledAt ? new Date(item.scheduledAt).toLocaleString() : "Time unavailable"} ({item.scheduledTimezone})</span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-slate-700">{item.text}</p>
            {item.errorMessage && <p className="mt-2 text-sm text-amber-700">{item.errorMessage}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
