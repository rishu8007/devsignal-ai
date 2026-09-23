"use client";
import { useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { getUsage, type UsageSummary } from "@/lib/api/usage-client";
export function UsageView({ active }: { active: boolean }) {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void getUsage(controller.signal).then(setData).catch((reason: unknown) => {
      if (!(reason instanceof ApiClientError && reason.code === "REQUEST_ABORTED")) setError(true);
    });
    return () => controller.abort();
  }, [active]);
  if (!active) return null;
  if (error) return <section className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">Unable to load usage.</section>;
  if (!data) return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6">Loading usage…</section>;
  return <section className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
    <h2 className="text-xl font-semibold">AI usage</h2>
    <p className="text-sm text-slate-600">Daily UTC allowance resets {new Date(data.resetAt).toLocaleString()}.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <div><p className="text-sm text-slate-500">Used</p><p className="text-2xl font-semibold">{data.used} / {data.limit}</p></div>
      <div><p className="text-sm text-slate-500">Reserved</p><p className="text-2xl font-semibold">{data.reserved}</p></div>
      <div><p className="text-sm text-slate-500">Remaining</p><p className="text-2xl font-semibold">{data.remaining}</p></div>
    </div>
    <p className="text-sm text-slate-600">Known token records: {data.knownUsageRecords}. Missing provider usage remains unavailable.</p>
    {data.estimatedCost ? <p className="text-sm text-slate-600">{data.estimatedCost.label} cost: {data.estimatedCost.currency} {data.estimatedCost.amount.toFixed(4)}</p> : <p className="text-sm text-slate-600">Estimated cost unavailable without configured pricing and provider usage.</p>}
    <ul className="divide-y divide-slate-100">{Object.entries(data.operations).map(([operation, value]) => <li className="flex justify-between py-2 text-sm" key={operation}><span>{operation}</span><span>{value.count} operation{value.count === 1 ? "" : "s"}</span></li>)}</ul>
  </section>;
}
