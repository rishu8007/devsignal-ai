import { DevSignalLogo } from "@/components/brand/devsignal-logo";

export function SiteHeader() {
  return (
    <header className="border-b border-white/10 bg-slate-950/90">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-8">
        <a href="#" aria-label="DevSignal AI home">
          <DevSignalLogo />
        </a>
        <nav aria-label="Main navigation">
          <ul className="flex items-center gap-5 text-sm text-slate-300 sm:gap-8">
            <li>
              <a
                className="rounded-lg border border-cyan-300/40 px-3 py-2 text-cyan-200 transition-colors hover:border-cyan-200 hover:bg-cyan-300/10"
                href="/dashboard"
              >
                Open workspace
              </a>
            </li>
            <li>
              <a
                className="rounded-lg border border-cyan-300/40 px-3 py-2 text-cyan-200 transition-colors hover:border-cyan-200 hover:bg-cyan-300/10"
                href="/dashboard"
              >
                Open workspace
              </a>
            </li>
            <li>
              <a className="transition-colors hover:text-cyan-300" href="#workflow">
                How it works
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
    </header>
  );
}
