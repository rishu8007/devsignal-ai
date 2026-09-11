import { Sparkles } from "lucide-react";
import type { PublicGeneration } from "@/lib/api/generation-client";

interface DraftStudioProps {
  signalTopic: string | null;
  generation: PublicGeneration | null;
  loading: boolean;
  generating: boolean;
  error: string | null;
  uncertain: boolean;
  onGenerate: () => void;
  onRetry: () => void;
}

const labels = {
  technical_depth: "Technical depth",
  learning_story: "Learning story",
  professional_impact: "Professional impact",
} as const;

export function DraftStudio({
  signalTopic,
  generation,
  loading,
  generating,
  error,
  uncertain,
  onGenerate,
  onRetry,
}: DraftStudioProps) {
  return (
    <section aria-labelledby="draft-studio-heading" className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-5 py-10 text-center sm:px-7">
      <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
        <Sparkles className="size-5" aria-hidden="true" />
      </div>
      <div className="mt-4 flex items-center justify-center gap-2">
        <h2 id="draft-studio-heading" className="text-lg font-semibold text-slate-900">Draft studio</h2>
          {generation && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-sm font-semibold text-indigo-700">3</span>}
      </div>
      {!signalTopic && <p className="mt-2 text-base font-medium text-slate-600">Select a Signal to view its drafts.</p>}
      {signalTopic && <p className="mt-2 text-base font-medium text-slate-900">{signalTopic}</p>}
      {loading && <p className="mt-5 text-sm text-slate-500" role="status">Loading saved drafts...</p>}
      {!loading && error && (
        <div className="mt-5" role="alert">
          <p className="text-sm text-red-700">{error}</p>
          {uncertain ? (
            <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Check for saved drafts</button>
          ) : (
            <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Retry</button>
          )}
        </div>
      )}
      {!loading && !error && signalTopic && !generation && (
        <>
          <p className="mt-5 text-sm text-slate-500">No drafts have been generated for this Signal.</p>
          <button type="button" onClick={onGenerate} disabled={generating} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {generating ? "Generating three drafts..." : "Generate three drafts"}
          </button>
        </>
      )}
      {generating && <p className="mt-5 text-sm text-slate-500" role="status">Generating three drafts. This may take a moment...</p>}
      {!loading && !error && generation && (
        <div className="mt-6 grid gap-4 text-left">
          {generation.variations.map((variation) => (
            <article key={variation.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{labels[variation.angle]}</h3>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Draft</span>
              </div>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{variation.content}</p>
            </article>
          ))}
          <p className="text-sm leading-6 text-amber-800">AI-generated drafts may contain unsupported details. Check every claim before using them.</p>
        </div>
      )}
    </section>
  );
}
