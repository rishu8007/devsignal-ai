import { FeaturesSection } from "@/components/marketing/features-section";
import { HeroSection } from "@/components/marketing/hero-section";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { WorkflowSection } from "@/components/marketing/workflow-section";

export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <SiteHeader />
      <main>
        <HeroSection />
        <WorkflowSection />
        <FeaturesSection />
      </main>
      <SiteFooter />
    </div>
  );
}
