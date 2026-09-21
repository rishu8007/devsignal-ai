import { useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { listKnowledgeSources, type PublicKnowledgeSource } from "@/lib/api/knowledge-source-client";
import {
  approveContentWorkflow,
  cancelContentWorkflow,
  getContentWorkflow,
  listContentWorkflows,
  reviewContentWorkflowVariation,
  startContentWorkflow,
  type ContentWorkflow,
} from "@/lib/api/content-workflow-client";

type Variation = { id?: string; angle?: string; content?: string };
type Finding = { category?: string; severity?: string; passage?: string; explanation?: string; suggestion?: string };

function firstReviewedVariationId(workflow: ContentWorkflow) {
  const output = workflow.generationOutput;
  const variations = output && typeof output === "object" ? (output as { variations?: Variation[] }).variations ?? [] : [];
  return variations.find((variation) => workflow.reviewBindings.some((binding) => binding.variationId === variation.id && !binding.stale && binding.status === "succeeded"))?.id ?? null;
}

export function ContentWorkflowView({ signalId }: { signalId: string }) {
  const [sources, setSources] = useState<PublicKnowledgeSource[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [workflow, setWorkflow] = useState<ContentWorkflow | null>(null);
  const [history, setHistory] = useState<ContentWorkflow[]>([]);
  const [selectedVariationId, setSelectedVariationId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reviewPendingId, setReviewPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([listKnowledgeSources({ page: 1, limit: 20 }), listContentWorkflows(signalId)])
      .then(([sourcePage, runs]) => {
        setSources(sourcePage.sources.filter((source) => source.processingStatus === "indexed"));
        setHistory(runs);
        setWorkflow(runs[0] ?? null);
        if (runs[0]) setSelectedVariationId(firstReviewedVariationId(runs[0]));
      })
      .catch(() => setError("Unable to load workflow inputs."));
  }, [signalId]);

  useEffect(() => {
    if (!workflow || !["queued", "running"].includes(workflow.status)) return;
    const timer = setInterval(() => {
      void getContentWorkflow(signalId, workflow.id).then(setWorkflow).catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [signalId, workflow]);

  const start = async () => {
    if (selected.length === 0 || selected.length > 5) return;
    setPending(true);
    setError(null);
    try {
      const run = await startContentWorkflow(signalId, selected);
      setWorkflow(run);
      setHistory((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    } catch (value: unknown) {
      setError(value instanceof ApiClientError ? value.message : "Unable to start workflow.");
    } finally {
      setPending(false);
    }
  };

  const approve = async () => {
    const output = workflow?.generationOutput;
    if (!workflow || !output || typeof output !== "object") return;
    const variations = (output as { variations?: Variation[] }).variations ?? [];
    const variation = variations.find((item) => item.id === selectedVariationId);
    if (!variation?.id || !variation.content) return;
    setPending(true);
    try {
      const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(variation.content));
      const draftHash = Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      setWorkflow(await approveContentWorkflow(signalId, workflow.id, variation.id, draftHash));
    } catch (value: unknown) {
      setError(value instanceof ApiClientError ? value.message : "Approval failed; the workflow was not changed.");
    } finally {
      setPending(false);
    }
  };

  const reviewVariation = async (variationId: string) => {
    if (!workflow) return;
    setReviewPendingId(variationId);
    setError(null);
    try {
      setWorkflow(await reviewContentWorkflowVariation(signalId, workflow.id, variationId));
      setSelectedVariationId(variationId);
    } catch (value: unknown) {
      setError(value instanceof ApiClientError ? value.message : "Review failed; your draft was not changed.");
    } finally {
      setReviewPendingId(null);
    }
  };

  const output = workflow?.generationOutput;
  const variations = output && typeof output === "object" ? (output as { variations?: Variation[] }).variations ?? [] : [];
  const selectedBinding = workflow?.reviewBindings.find((binding) => binding.variationId === selectedVariationId && !binding.stale && binding.status === "succeeded");
  const findings = (selectedBinding?.findings ?? []) as Finding[];

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Workflow</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Research to approval</h2></div>
        {workflow && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{workflow.status.replaceAll("_", " ")}</span>}
      </div>
      <p className="mt-2 text-sm text-slate-600">Research -&gt; Write drafts -&gt; Technical review -&gt; Await human approval. Nothing publishes or schedules automatically.</p>
      <div className="mt-4 flex flex-wrap gap-2">{sources.map((source) => <label key={source.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={selected.includes(source.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, source.id].slice(0, 5) : current.filter((id) => id !== source.id))} />{" "}{source.title}</label>)}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void start()} disabled={pending || selected.length === 0} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Starting..." : "Start workflow"}</button>
        {workflow && ["queued", "running", "awaiting_approval"].includes(workflow.status) && <button type="button" onClick={() => { setPending(true); void cancelContentWorkflow(signalId, workflow.id).then(setWorkflow).finally(() => setPending(false)); }} disabled={pending} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>}
      </div>
      {workflow?.status === "awaiting_approval" && <div className="mt-4 space-y-2"><p className="text-sm font-semibold text-slate-800">Select a draft and review it before approval</p>{variations.map((variation) => { const binding = workflow.reviewBindings.find((item) => item.variationId === variation.id); const currentReview = binding && !binding.stale && binding.status === "succeeded"; return <div key={variation.id} className="rounded-lg border border-slate-200 p-3 text-sm"><label className="block"><input type="radio" name="workflow-variation" checked={selectedVariationId === variation.id} onChange={() => setSelectedVariationId(variation.id ?? null)} />{" "}<span className="font-semibold">{variation.angle ?? "Draft"}</span>{currentReview ? <span className="ml-2 text-xs text-emerald-700">Current review</span> : <span className="ml-2 text-xs text-amber-700">Review required</span>}<p className="mt-1 whitespace-pre-wrap text-slate-600">{variation.content}</p></label>{!currentReview && variation.id && <button type="button" onClick={() => void reviewVariation(variation.id!)} disabled={reviewPendingId !== null} className="mt-2 rounded-lg border border-indigo-300 px-3 py-1 text-xs font-semibold text-indigo-700">{reviewPendingId === variation.id ? "Reviewing..." : "Review this variation"}</button>}</div>; })}<button type="button" onClick={() => void approve()} disabled={pending || !selectedVariationId || !selectedBinding} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve selected draft</button></div>}
      {findings.length > 0 && <div className="mt-4 space-y-2"><h3 className="font-semibold text-slate-800">Technical review findings</h3>{findings.map((finding, index) => <details key={`${finding.passage}-${index}`} className="rounded-lg border border-slate-200 p-3 text-sm"><summary className="cursor-pointer font-semibold">{finding.severity ?? "Review"}: {finding.category ?? "Finding"}</summary><p className="mt-2 text-slate-700">{finding.explanation}</p>{finding.passage && <p className="mt-2 border-l-2 border-indigo-300 pl-2 text-slate-600">“{finding.passage}”</p>}{finding.suggestion && <p className="mt-2 text-slate-600">Suggested: {finding.suggestion}</p>}</details>)}</div>}
      {workflow?.status === "awaiting_research" && <p className="mt-4 text-sm text-amber-700">No reliable evidence was found in the selected sources. Add or index more Knowledge before starting another workflow.</p>}
      {history.length > 1 && <p className="mt-4 text-xs text-slate-500">Saved workflow runs: {history.length}</p>}
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
    </section>
  );
}
