import { BarChart3, BookOpen, CalendarDays, FileText, PencilLine, UserRound, Lightbulb, Gauge } from "lucide-react";

export type WorkspaceTab = "create" | "drafts" | "calendar" | "knowledge" | "profile" | "planner" | "connections" | "analytics" | "usage";

export function WorkspaceNavigation({
  activeTab,
  onChange,
  disabled,
}: {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  disabled: boolean;
}) {
  const navigationItems = [
    { label: "Create", icon: PencilLine, tab: "create" as const },
    { label: "Drafts", icon: FileText, tab: "drafts" as const },
    { label: "Calendar", icon: CalendarDays, tab: "calendar" as const },
    { label: "Knowledge", icon: BookOpen, tab: "knowledge" as const },
    { label: "Profile", icon: UserRound, tab: "profile" as const },
    { label: "Topics", icon: Lightbulb, tab: "planner" as const },
    { label: "Connections", icon: UserRound, tab: "connections" as const },
    { label: "Analytics", icon: BarChart3, tab: "analytics" as const },
    { label: "Usage", icon: Gauge, tab: "usage" as const },
  ];
  return (
    <nav aria-label="Workspace sections" className="mt-10 border-b border-slate-200">
      <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9">
        {navigationItems.map(({ tab, icon: Icon, label }) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => onChange(tab)}
              disabled={disabled}
              className={`flex w-full items-center justify-center gap-2 border-b-2 px-3 py-3 text-base font-medium transition-colors ${
                activeTab === tab
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              }`}
              aria-current={activeTab === tab ? "page" : undefined}
              title={disabled ? "Save or cancel the current edit first." : undefined}
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
