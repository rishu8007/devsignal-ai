import { ChevronDown, Edit3 } from "lucide-react";

const selectOptions = {
  contentType: ["Project update", "Learning", "Technical insight", "Build in public"],
  audience: [
    "Recruiters & hiring teams",
    "Developers & engineers",
    "Founders & product teams",
    "AI community",
  ],
};

export function NewSignalForm() {
  return (
    <section
      aria-labelledby="new-signal-heading"
      className="relative mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div
        className="h-1 bg-gradient-to-r from-indigo-500 via-cyan-400 to-teal-400"
        aria-hidden="true"
      />
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">
              New signal
            </p>
            <h2 id="new-signal-heading" className="mt-2 text-xl font-semibold text-slate-900">
              What did you work on?
            </h2>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Edit new signal"
          >
            <Edit3 className="size-4" aria-hidden="true" />
          </button>
        </div>
        <form className="mt-7 space-y-5">
          <div>
            <label htmlFor="topic" className="mb-2 block text-base font-medium text-slate-700">
              Topic or feature
            </label>
            <input
              id="topic"
              name="topic"
              type="text"
              placeholder="e.g. Adding hybrid search to my RAG application"
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-900 placeholder:text-slate-400"
            />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label
                htmlFor="learning-notes"
                className="block text-base font-medium text-slate-700"
              >
                Learning notes
              </label>
              <span className="text-sm text-slate-400">0/4,000</span>
            </div>
            <textarea
              id="learning-notes"
              name="learning-notes"
              rows={5}
              placeholder="Describe the problem, your approach, tools used, result, and one lesson. The more specific you are, the more credible your posts will be."
              className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-base leading-6 text-slate-900 placeholder:text-slate-400"
            />
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <SelectField
              id="content-type"
              label="Content type"
              options={selectOptions.contentType}
            />
            <SelectField id="audience" label="Primary audience" options={selectOptions.audience} />
          </div>
          <button
            type="button"
            disabled
            className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-lg bg-indigo-600 px-4 py-3 text-base font-semibold text-white opacity-45 sm:w-auto"
          >
            Generate three variations
          </button>
        </form>
      </div>
    </section>
  );
}

interface SelectFieldProps {
  id: string;
  label: string;
  options: string[];
}

function SelectField({ id, label, options }: SelectFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-medium text-slate-700">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          name={id}
          defaultValue={options[0]}
          className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3.5 py-3 pr-10 text-base text-slate-800"
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
