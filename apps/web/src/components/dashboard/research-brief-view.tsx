"use client";
import { useEffect, useState } from "react";
import { listKnowledgeSources, type PublicKnowledgeSource } from "@/lib/api/knowledge-source-client";
import { createResearchBrief, getResearchBrief, listResearchBriefs, type ResearchBrief } from "@/lib/api/research-brief-client";
import type { PublicSignal } from "@/lib/api/signal-client";

export function ResearchBriefView({ signal, onClose }: { signal: PublicSignal; onClose: () => void }) {
  const [sources, setSources] = useState<PublicKnowledgeSource[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [briefs, setBriefs] = useState<ResearchBrief[]>([]);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void Promise.all([listKnowledgeSources({ page: 1, limit: 20, processingStatus: "indexed" }), listResearchBriefs(signal.id)]).then(([sourceResult, saved]) => { setSources(sourceResult.sources); setBriefs(saved); }).catch(() => setMessage("Unable to load research sources or saved briefs.")); }, [signal.id]);
  async function research() {
    setPending(true); setMessage(null);
    try { const result = await createResearchBrief(signal.id, { requestId: crypto.randomUUID(), sourceIds: selected }); setBrief(result); setBriefs((current) => [result, ...current]); } catch { setMessage("Unable to build the research brief. Your Signal was not changed."); } finally { setPending(false); }
  }
  async function reopen(saved: ResearchBrief) {
    try { setBrief(await getResearchBrief(signal.id, saved.id)); } catch { setMessage("Unable to reopen this saved brief."); }
  }
  return <section className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-5" aria-label="Research brief">
    <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">Research</p><h2 className="mt-2 text-xl font-semibold">{signal.topic}</h2><p className="text-sm text-slate-500">Signal revision {signal.revision}; research never edits the Signal.</p></div><button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm">Return to Signal</button></div>
    <fieldset><legend className="font-medium">Selected indexed Knowledge sources</legend>{sources.map((source) => <label key={source.id} className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(source.id)} disabled={!selected.includes(source.id) && selected.length >= 5} onChange={() => setSelected((items) => items.includes(source.id) ? items.filter((id) => id !== source.id) : [...items, source.id])}/>{source.title}</label>)}</fieldset>
    <button type="button" disabled={pending || selected.length === 0} onClick={() => void research()} className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">{pending ? "Researching…" : "Build research brief"}</button>
    {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
    {briefs.length > 0 && <div><p className="font-medium">Saved briefs</p><div className="mt-2 flex flex-wrap gap-2">{briefs.map((saved) => <button type="button" key={saved.id} onClick={() => void reopen(saved)} className="rounded border px-3 py-2 text-sm">{new Date(saved.createdAt).toLocaleString()} · {saved.status}{saved.stale ? " · stale" : ""}</button>)}</div></div>}
    {brief && <article className="space-y-4 border-t pt-4"><p className="text-sm text-slate-500">{brief.stale ? "This historical brief is stale because the Signal or selected Knowledge changed." : brief.status === "no_evidence" ? "No relevant evidence was found in the selected sources." : "Supported by selected sources. These assessments are not independently verified facts."}</p><h3 className="font-semibold">{brief.brief.topicSummary}</h3><h4 className="font-medium">Talking points</h4>{brief.brief.talkingPoints.map((item) => <p key={item.text} className="text-sm">{item.text} <span className="text-slate-500">({item.evidenceIds.join(", ") || "no evidence"})</span></p>)}<h4 className="font-medium">Claim assessments</h4>{brief.brief.claimAssessments.map((item) => <div key={item.claim} className="rounded bg-slate-50 p-3 text-sm"><strong>{item.assessment}</strong>: {item.claim}<p className="mt-1 text-slate-600">{item.explanation}</p></div>)}<h4 className="font-medium">Evidence excerpts</h4>{brief.evidence.map((item) => <details key={item.evidenceId}><summary className="cursor-pointer text-sm font-medium">{item.evidenceId} · source {item.sourceId}</summary><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{item.quote}</p></details>)}</article>}
  </section>;
}
