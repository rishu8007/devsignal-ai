import { DevSignalLogo } from "@/components/brand/devsignal-logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <DevSignalLogo compact />
          <span>DevSignal AI</span>
        </div>
        <nav aria-label="Footer navigation">
          <ul className="flex gap-5">
            <li>
              <a className="transition-colors hover:text-cyan-300" href="#workflow">
                Workflow
              </a>
            </li>
            <li>
              <a className="transition-colors hover:text-cyan-300" href="#features">
                Features
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
