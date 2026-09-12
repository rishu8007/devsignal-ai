import { CalendarDays, CheckCircle2, FileText } from "lucide-react";

export function WorkspaceOverview({ total, approved }: { total: number | null; approved: number | null }) {
  const statistics = [
    { label: "Signals", value: total === null ? "—" : String(total), icon: FileText, tone: "text-indigo-600 bg-indigo-50" },
    { label: "Approved", value: approved === null ? "—" : String(approved), icon: CheckCircle2, tone: "text-teal-600 bg-teal-50" },
    { label: "Scheduled", value: "0", icon: CalendarDays, tone: "text-amber-600 bg-amber-50" },
  ];
  return (
    <section
      aria-labelledby="workspace-heading"
      className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between"
    >
      <div className="max-w-2xl">
        <div className="inline-flex items-center gap-2 text-base font-medium text-teal-700">
          <span className="size-2 rounded-full bg-teal-500" aria-hidden="true" />
          Your signal workspace is ready
        </div>
        <h1
          id="workspace-heading"
          className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl"
        >
          Turn today&apos;s progress into a signal.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
          Capture what you built or learned, then shape it into credible posts for the people you want to reach.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:max-w-md lg:w-[390px]">
        {statistics.map(({ icon: Icon, label, tone, value }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <div className={`mb-4 flex size-8 items-center justify-center rounded-lg ${tone}`}>
              <Icon className="size-4" aria-hidden="true" />
            </div>
            <p className="text-xl font-semibold text-slate-900">{value}</p>
            <p className="mt-1 text-sm text-slate-500">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
