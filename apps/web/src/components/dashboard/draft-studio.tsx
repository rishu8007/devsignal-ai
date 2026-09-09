import { Sparkles } from "lucide-react";

export function DraftStudio() {
  return (
    <section aria-labelledby="draft-studio-heading" className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-5 py-10 text-center sm:px-7">
      <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
        <Sparkles className="size-5" aria-hidden="true" />
      </div>
      <div className="mt-4 flex items-center justify-center gap-2">
        <h2 id="draft-studio-heading" className="text-lg font-semibold text-slate-900">Draft studio</h2>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-sm font-semibold text-indigo-700">3</span>
      </div>
        <p className="mt-2 text-base font-medium text-slate-600">Your variations will appear here</p>
        <p className="mt-5 text-base font-medium text-slate-800">Three angles, one real experience</p>
        <p className="mx-auto mt-2 max-w-lg text-base leading-6 text-slate-500">
        Add enough context to create a concise insight, a build-in-public story, and a technical breakdown.
      </p>
    </section>
  );
}
