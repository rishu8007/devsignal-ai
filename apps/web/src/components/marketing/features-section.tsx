const features = [
  {
    title: "Grounded in your work",
    description:
      "Keep the source material close so your content reflects what you actually learned and built.",
  },
  {
    title: "Three useful directions",
    description:
      "Compare distinct practical, reflective, and technical angles instead of choosing between near-duplicates.",
  },
  {
    title: "You stay in control",
    description:
      "Every draft is a starting point. Nothing is published automatically, and your approval remains the final step.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-8">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">
              Built for credibility
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Consistency without losing your voice.
            </h2>
          </div>
          <ul className="grid gap-8 sm:grid-cols-3">
            {features.map((feature) => (
              <li key={feature.title}>
                <div className="mb-4 size-2 rounded-full bg-indigo-300" aria-hidden="true" />
                <h3 className="font-semibold text-white">{feature.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-400">{feature.description}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-20 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 px-6 py-10 text-center sm:px-10">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Your next useful insight is already in your notes.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-300">
            Give your technical work a clear starting point, then decide what
            deserves to be shared.
          </p>
          <a
            href="#preview"
            className="mt-7 inline-flex items-center justify-center rounded-lg bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-200"
          >
            Explore the preview
          </a>
        </div>
      </div>
    </section>
  );
}
