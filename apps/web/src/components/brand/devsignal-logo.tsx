interface DevSignalLogoProps {
  compact?: boolean;
}

export function DevSignalLogo({ compact = false }: DevSignalLogoProps) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="DevSignal AI">
      <span
        className="flex size-8 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-300"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none">
          <path
            d="M5 15.5 9.5 11l3 3L19 7.5M16 7.5H19v3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {!compact && (
        <span className="text-sm font-semibold tracking-tight text-white">
          DevSignal <span className="text-cyan-300">AI</span>
        </span>
      )}
    </span>
  );
}
