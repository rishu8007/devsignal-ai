import type { Metadata } from "next";
import { AppHeader } from "@/components/dashboard/app-header";
import { DraftStudio } from "@/components/dashboard/draft-studio";
import { NewSignalForm } from "@/components/dashboard/new-signal-form";
import { WorkspaceNavigation } from "@/components/dashboard/workspace-navigation";
import { WorkspaceOverview } from "@/components/dashboard/workspace-overview";

export const metadata: Metadata = {
  title: "Workspace | DevSignal AI",
  description:
    "Create credible, human-approved professional content from your development work and learning notes.",
};

export default function DashboardPage() {
  return (
    <div className="workspace-grid min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-[1150px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <WorkspaceOverview />
        <WorkspaceNavigation />
        <NewSignalForm />
        <DraftStudio />
      </main>
    </div>
  );
}
