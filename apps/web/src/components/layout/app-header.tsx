import { LogOut } from "lucide-react";

export function AppHeader() {
  return (
    <header className="border-b border-slate-200/80 bg-white">
      <div className="mx-auto flex max-w-[1150px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-teal-400 text-xs font-bold text-white shadow-sm"
            aria-label="DevSignal AI logo"
          >
            DS
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">DevSignal AI</p>
            <p className="truncate text-xs text-slate-500">Content workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-slate-800">Rishabh Shukla</p>
            <p className="text-xs text-slate-500">Developer workspace</p>
          </div>
          <div
            className="flex size-9 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700"
            aria-label="Rishabh Shukla avatar"
          >
            RS
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            aria-label="Sign out"
          >
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
