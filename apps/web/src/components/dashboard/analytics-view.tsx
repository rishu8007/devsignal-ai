"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { createEngagement, deleteEngagement, getAnalytics, updateEngagement, type AnalyticsResponse, type Engagement } from "@/lib/api/analytics-client";

const fields = ["impressions", "reactions", "comments", "reposts"] as const;
type RangePreset = "7d" | "30d" | "custom";

function localDate(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return date.toISOString().slice(0, 10);
}

export function AnalyticsView({ active }: { active: boolean }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [from, setFrom] = useState(localDate(29));
  const [to, setTo] = useState(localDate(0));
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) return;
    const current = ++requestId.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    queueMicrotask(() => {
      if (current === requestId.current) {
        setLoading(true);
        setError(null);
      }
    });
    void getAnalytics({ preset, from: preset === "custom" ? from : undefined, to: preset === "custom" ? to : undefined, timezone }, next.signal)
      .then((result) => { if (current === requestId.current) setData(result); })
      .catch((cause: unknown) => {
        if (cause instanceof ApiClientError && cause.code === "REQUEST_ABORTED") return;
        if (current === requestId.current) setError(cause instanceof ApiClientError ? cause.message : "Analytics could not be loaded.");
      })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return () => next.abort();
  }, [active, from, preset, timezone, to]);

  const metricLabels = useMemo(() => [
    ["Signals created", "signalsCreated"], ["Completed generations", "generationsCompleted"], ["Approved variations", "approvedVariations"],
    ["Confirmed published", "confirmedPublished"], ["Currently scheduled", "scheduledPublications"], ["Rejected", "rejected"],
    ["Blocked", "blocked"], ["Missed", "missed"], ["Uncertain", "uncertain"],
  ] as const, []);

  async function saveEngagement(postId: string, engagement: Engagement | null, form: HTMLFormElement) {
    const formData = new FormData(form);
    const input = Object.fromEntries(fields.map((field) => {
      const value = String(formData.get(field) ?? "").trim();
      return [field, value === "" ? null : Number(value)];
    })) as Record<(typeof fields)[number], number | null>;
    const observedAtValue = String(formData.get("observedAt") ?? "");
    const observedAt = observedAtValue ? new Date(`${observedAtValue}:00`).toISOString() : "";
    try {
      const saved = engagement
        ? await updateEngagement(engagement.id, { ...input, observedAt, expectedRevision: engagement.revision })
        : await createEngagement({ publicationId: postId, ...input, observedAt });
      setData((current) => current && ({ ...current, posts: current.posts.map((post) => post.publicationId === postId ? { ...post, engagement: saved } : post) }));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Engagement could not be saved.");
    }
  }

  async function removeEngagement(engagement: Engagement) {
    if (!window.confirm("Delete this manually entered engagement snapshot?")) return;
    try {
      await deleteEngagement(engagement.id, engagement.revision);
      setData((current) => current && ({ ...current, posts: current.posts.map((post) => post.engagement?.id === engagement.id ? { ...post, engagement: null } : post) }));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Engagement could not be deleted.");
    }
  }

  return (
    <section className="mt-8 space-y-6" aria-labelledby="analytics-heading">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div><label className="block text-sm font-medium text-slate-700" htmlFor="analytics-range">Range</label><select id="analytics-range" value={preset} onChange={(event) => setPreset(event.target.value as RangePreset)} className="mt-1 rounded border p-2"><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom</option></select></div>
        {preset === "custom" && <><label className="text-sm text-slate-700">From <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="ml-1 rounded border p-2" /></label><label className="text-sm text-slate-700">To <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="ml-1 rounded border p-2" /></label></>}
        <label className="text-sm text-slate-700">Reporting timezone <input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="ml-1 rounded border p-2" aria-describedby="analytics-timezone-help" /></label>
        <p id="analytics-timezone-help" className="basis-full text-xs text-slate-500">Use an IANA timezone such as Asia/Kolkata. Date boundaries are calculated in this timezone, then queried in UTC.</p>
      </div>
      {loading && <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500">Loading analytics...</p>}
      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</p>}
      {!loading && !error && data && <div className="space-y-6">
        <h2 id="analytics-heading" className="text-2xl font-semibold text-slate-900">Analytics</h2>
        <p className="text-sm text-slate-500">Application activity uses persisted records for {data.range.startDate}–{data.range.endDate} in {data.range.timezone}. Engagement is manually entered and never fetched from LinkedIn.</p>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{metricLabels.map(([label, key]) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-2xl font-semibold">{data.activity[key]}</p><p className="text-sm text-slate-500">{label}</p></div>)}</div>
        <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Topic comparison</h3><p className="mt-1 text-xs text-slate-500">Topics are the exact Signal topic text. Publications are filtered by publication date; snapshots use the latest observation at or before the report end. “Posts with data” may include partial snapshots. Rate coverage counts only posts with positive impressions and known reactions, comments, and reposts.</p><div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Topic</th><th className="p-2">Published</th><th className="p-2">Posts with data</th><th className="p-2">Engagement totals</th><th className="p-2">Rate coverage</th><th className="p-2">Engagement rate</th></tr></thead><tbody>{data.topics.map((topic) => <tr key={topic.topic} className="border-b"><td className="p-2">{topic.topic}</td><td className="p-2">{topic.publications}</td><td className="p-2">{topic.engagementPosts}</td><td className="p-2">{topic.engagementPosts ? `${topic.reactions + topic.comments + topic.reposts} interactions` : "Unavailable"}</td><td className="p-2">{topic.rateEligiblePosts} post(s)</td><td className="p-2">{topic.engagementRate === null ? "Unavailable" : `${(topic.engagementRate * 100).toFixed(2)}%`}</td></tr>)}</tbody></table>{data.topics.length === 0 && <p className="p-3 text-sm text-slate-500">No confirmed publications in this range.</p>}</div></section>
        <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Technical review insights</h3><p className="mt-1 text-sm text-slate-500">Based on {data.reviewInsights.population} latest successful, non-stale review(s) for signal/variation pairs. These findings are not predictions of LinkedIn engagement.</p><p className="mt-2 text-sm">Severity: {Object.entries(data.reviewInsights.severities).map(([key, value]) => `${key} ${value}`).join(", ") || "No findings"}</p><p className="text-sm">Categories: {Object.entries(data.reviewInsights.categories).map(([key, value]) => `${key} ${value}`).join(", ") || "No findings"}</p></section>
        <section className="space-y-3"><h3 className="font-semibold">Published posts and manual engagement</h3>{data.posts.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No confirmed published posts in this range.</p>}{data.posts.map((post) => <form key={post.publicationId} onSubmit={(event) => { event.preventDefault(); void saveEngagement(post.publicationId, post.engagement, event.currentTarget); }} className="rounded-xl border border-slate-200 bg-white p-4"><p className="font-medium">{post.topic}</p><p className="mt-1 line-clamp-2 text-sm text-slate-600">{post.text}</p><p className="text-xs text-slate-500">Published {new Date(post.publishedAt).toLocaleString()}</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{fields.map((field) => <label key={field} className="text-xs text-slate-500">{field}<input name={field} type="number" min="0" step="1" defaultValue={post.engagement?.[field] ?? ""} className="mt-1 w-full rounded border p-2" /></label>)}<label className="text-xs text-slate-500">Observed at<input name="observedAt" type="datetime-local" required defaultValue={post.engagement ? new Date(post.engagement.observedAt).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16)} className="mt-1 w-full rounded border p-2" /></label></div><div className="mt-3 flex gap-2"><button type="submit" className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white">{post.engagement ? "Save correction" : "Record snapshot"}</button>{post.engagement && <button type="button" onClick={() => { if (post.engagement) void removeEngagement(post.engagement); }} className="rounded border border-red-200 px-3 py-2 text-sm text-red-700">Delete snapshot</button>}<span className="self-center text-xs text-slate-500">Manually entered; blank means unknown, not zero.</span></div></form>)}</section>
      </div>}
    </section>
  );
}
