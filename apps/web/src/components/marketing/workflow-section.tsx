const workflowSteps = [
  {
    number: "01",
    title: "Capture a learning note",
    description:
      "Start with the technical detail, project update, or lesson you want to make easier to share.",
  },
  {
    number: "02",
    title: "Generate three variations",
    description:
      "DevSignal AI shapes your source material into three meaningfully different post directions.",
  },
  {
    number: "03",
    title: "Review and approve",
    description:
      "Choose the version that feels right, refine it, and approve it before anything can be published.",
  },
];

export function WorkflowSection() {
  return (
    <section id="workflow" className="scroll-mt-8 border-y border-white/10 bg-slate-900/50">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">
            A deliberate workflow
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            From raw notes to a post you stand behind.
          </h2>
        </div>
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {workflowSteps.map((step) => (
            <li key={step.number} className="border-t border-slate-700 pt-5">
              <span className="font-mono text-sm text-indigo-300">{step.number}</span>
              <h3 className="mt-8 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-400">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
