import { CalendarDays, FileText, PencilLine } from "lucide-react";

const navigationItems = [
  { label: "Create", icon: PencilLine, active: true },
  { label: "Drafts", icon: FileText, active: false },
  { label: "Calendar", icon: CalendarDays, active: false },
];

export function WorkspaceNavigation() {
  return (
    <nav aria-label="Workspace sections" className="mt-10 border-b border-slate-200">
      <ul className="grid grid-cols-3">
        {navigationItems.map(({ active, icon: Icon, label }) => (
          <li key={label}>
            <button
              type="button"
              className={`flex w-full items-center justify-center gap-2 border-b-2 px-3 py-3 text-base font-medium transition-colors ${
                active
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
