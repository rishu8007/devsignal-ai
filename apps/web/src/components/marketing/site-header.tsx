import { DevSignalLogo } from "@/components/brand/devsignal-logo";

export function SiteHeader() {
  return (
    <header className="border-b border-white/10 bg-slate-950/90">
      <div className="mx-auto flex max-w-7xl flex-col items-stretch gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-6 md:py-5 lg:px-8">
        <a className="self-start whitespace-nowrap md:self-auto" href="#" aria-label="DevSignal AI home">
          <DevSignalLogo />
        </a>
        <nav aria-label="Main navigation">
          <ul className="grid grid-cols-2 items-center gap-x-4 gap-y-2 text-sm text-slate-300 md:flex md:gap-5 lg:gap-8">
            <li className="col-span-2 md:col-span-1">
              <a
                className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg border border-cyan-300/40 px-3 py-2 text-cyan-200 transition-colors hover:border-cyan-200 hover:bg-cyan-300/10 md:w-auto"
                href="/dashboard"
              >
                Open workspace
              </a>
            </li>
            <li>
              <a className="inline-flex items-center justify-center whitespace-nowrap transition-colors hover:text-cyan-300" href="#workflow">
                How it works
              </a>
            </li>
            <li>
              <a className="inline-flex items-center justify-center whitespace-nowrap transition-colors hover:text-cyan-300" href="#features">
                Features
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
