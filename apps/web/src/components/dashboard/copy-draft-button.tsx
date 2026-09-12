"use client";

import { useEffect, useRef, useState } from "react";

interface CopyDraftButtonProps {
  content: string;
  disabled?: boolean;
}

export function CopyDraftButton({ content, disabled = false }: CopyDraftButtonProps) {
  const [feedback, setFeedback] = useState<
    { content: string; status: "copied" | "failed" } | null
  >(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [content]);

  async function handleCopy(): Promise<void> {
    if (disabled) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(content);
      setFeedback({ content, status: "copied" });
      timer.current = window.setTimeout(() => setFeedback(null), 2000);
    } catch {
      setFeedback({ content, status: "failed" });
    }
  }

  const visibleFeedback = feedback?.content === content ? feedback.status : null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void handleCopy()}
        disabled={disabled}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Copy draft
      </button>
      {visibleFeedback === "copied" && (
        <span className="text-sm font-medium text-teal-700" role="status" aria-live="polite">
          Copied
        </span>
      )}
      {visibleFeedback === "failed" && (
        <span className="text-sm text-red-700" role="alert">
          Copy failed. Select the text above and copy it manually.
        </span>
      )}
    </div>
  );
}
