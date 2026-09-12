import { Sparkles } from "lucide-react";
import type {
  GenerationAngle,
  PublicGeneration,
  PublicDraft,
} from "@/lib/api/generation-client";

interface DraftStudioProps {
  signalTopic: string | null;
  generation: PublicGeneration | null;
  loading: boolean;
  generating: boolean;
  mutationPending: boolean;
  error: string | null;
  uncertain: boolean;
  mutationError: string | null;
  editingVariationId: string | null;
  editorContent: string;
  onEditorContentChange: (content: string) => void;
  onStartEditing: (variation: PublicDraft) => void;
  onCancelEditing: () => void;
  onSaveEditing: () => void;
  onApprove: (variationId: string) => void;
  onGenerate: () => void;
  onRetry: () => void;
}

const labels: Record<GenerationAngle, string> = {
  technical_depth: "Technical depth",
  learning_story: "Learning story",
  professional_impact: "Professional impact",
};

const MIN_CONTENT_LENGTH = 100;
const MAX_CONTENT_LENGTH = 3000;

export function DraftStudio({
  signalTopic,
  generation,
  loading,
  generating,
  mutationPending,
  error,
  uncertain,
  mutationError,
  editingVariationId,
  editorContent,
  onEditorContentChange,
  onStartEditing,
  onCancelEditing,
  onSaveEditing,
  onApprove,
  onGenerate,
  onRetry,
}: DraftStudioProps) {
  const trimmedLength = editorContent.trim().length;
  const editingVariation = generation?.variations.find(
    (variation) => variation.id === editingVariationId,
  );
  const contentValid =
    trimmedLength >= MIN_CONTENT_LENGTH && trimmedLength <= MAX_CONTENT_LENGTH;
  const contentUnchanged =
    editingVariation !== undefined && editorContent === editingVariation.content;

  return (
    <section
      aria-labelledby="draft-studio-heading"
      className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-5 py-10 text-center sm:px-7"
    >
      <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
        <Sparkles className="size-5" aria-hidden="true" />
      </div>
      <div className="mt-4 flex items-center justify-center gap-2">
        <h2 id="draft-studio-heading" className="text-lg font-semibold text-slate-900">
          Draft studio
        </h2>
        {generation && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-sm font-semibold text-indigo-700">
            3
          </span>
        )}
      </div>
      {!signalTopic && (
        <p className="mt-2 text-base font-medium text-slate-600">
          Select a Signal to view its drafts.
        </p>
      )}
      {signalTopic && <p className="mt-2 text-base font-medium text-slate-900">{signalTopic}</p>}
      {loading && (
        <p className="mt-5 text-sm text-slate-500" role="status">
          Loading saved drafts...
        </p>
      )}
      {!loading && error && (
        <div className="mt-5" role="alert">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {uncertain ? "Check for saved drafts" : "Retry"}
          </button>
        </div>
      )}
      {!loading && !error && signalTopic && !generation && (
        <>
          <p className="mt-5 text-sm text-slate-500">
            No drafts have been generated for this Signal.
          </p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating || mutationPending}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? "Generating three drafts..." : "Generate three drafts"}
          </button>
        </>
      )}
      {generating && (
        <p className="mt-5 text-sm text-slate-500" role="status">
          Generating three drafts. This may take a moment...
        </p>
      )}
      {!loading && !error && generation && (
        <div className="mt-6 grid gap-4 text-left">
          {generation.variations.map((variation) => {
            const isEditing = variation.id === editingVariationId;
            const isApproved = variation.status === "approved";

            return (
              <article key={variation.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{labels[variation.angle]}</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {isApproved ? "Approved" : "Draft"}
                  </span>
                </div>
                {isEditing ? (
                  <>
                    <textarea
                      value={editorContent}
                      onChange={(event) => onEditorContentChange(event.target.value)}
                      disabled={mutationPending}
                      className="mt-4 min-h-48 w-full rounded-lg border border-slate-300 p-3 text-sm leading-7 text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
                      aria-label={`Edit ${labels[variation.angle]}`}
                    />
                    <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                      <span>{trimmedLength} / {MAX_CONTENT_LENGTH} characters</span>
                      {!contentValid && (
                        <span className="text-red-600">
                          Content must be {MIN_CONTENT_LENGTH}–{MAX_CONTENT_LENGTH} trimmed characters.
                        </span>
                      )}
                    </div>
                    {isApproved && (
                      <p className="mt-3 text-xs leading-5 text-amber-800">
                        Saving edits to an approved draft resets its approval to Draft.
                      </p>
                    )}
                    {mutationError && (
                      <p className="mt-3 text-sm text-red-700" role="alert">{mutationError}</p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={onSaveEditing}
                        disabled={!contentValid || contentUnchanged || mutationPending}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {mutationPending ? "Saving..." : "Save changes"}
                      </button>
                      <button
                        type="button"
                        onClick={onCancelEditing}
                        disabled={mutationPending}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                      {variation.content}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => onStartEditing(variation)}
                        disabled={mutationPending}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Edit
                      </button>
                      {!isApproved && (
                        <button
                          type="button"
                          onClick={() => onApprove(variation.id)}
                          disabled={mutationPending}
                          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {mutationPending ? "Approving..." : "Approve"}
                        </button>
                      )}
                    </div>
                    {mutationError && (
                      <p className="mt-3 text-sm text-red-700" role="alert">{mutationError}</p>
                    )}
                  </>
                )}
              </article>
            );
          })}
          <p className="text-sm leading-6 text-amber-800">
            AI-generated drafts may contain unsupported details. Check every claim before using them.
          </p>
        </div>
      )}
    </section>
  );
}
