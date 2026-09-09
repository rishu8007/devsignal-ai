const postVariations = [
  {
    label: "01 / Practical",
    text: "A clear way to explain the trade-off behind a technical decision.",
  },
  {
    label: "02 / Reflective",
    text: "What this project taught me about making progress visible to a team.",
  },
  {
    label: "03 / Technical",
    text: "The implementation detail I would document differently next time.",
  },
];

export function HeroSection() {
  return (
    <section className="mx-auto grid max-w-7xl gap-16 px-6 pb-24 pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8 lg:pb-32 lg:pt-28">
      <div>
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-medium text-cyan-200">
          <span className="size-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
          Human-approved AI
        </div>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-6xl sm:leading-[1.08]">
          Make your technical work <span className="text-cyan-300">visible.</span>
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
          DevSignal AI turns learning notes, project updates, and technical
          work into credible LinkedIn posts that still sound like you.
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <a
            href="#preview"
            className="inline-flex items-center justify-center rounded-lg bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-200"
          >
            See the workflow
          </a>
          <a
            href="#workflow"
            className="inline-flex items-center justify-center rounded-lg border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition-colors hover:border-cyan-300 hover:text-cyan-200"
          >
            How it works
          </a>
        </div>
        <p className="mt-5 text-xs text-slate-500">
          Three thoughtful variations. You review and approve every post.
        </p>
      </div>

      <div id="preview" className="scroll-mt-8">
        <div className="rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-2xl shadow-cyan-950/20 sm:p-6">
          <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">
                Draft workspace
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Three directions from one note
              </p>
            </div>
            <span className="rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-[11px] font-medium text-amber-200">
              Needs review
            </span>
          </div>
          <div className="space-y-3">
            {postVariations.map((variation) => (
              <article
                key={variation.label}
                className="rounded-xl border border-white/10 bg-slate-950/70 p-4"
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-300">
                  {variation.label}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  {variation.text}
                </p>
              </article>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-xs text-slate-500">
            <span>Generated from your notes</span>
            <span>Approval required</span>
          </div>
        </div>
      </div>
    </section>
  );
}
