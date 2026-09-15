import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import {
  getKnowledgeSource,
  type PublicKnowledgeSource,
} from "@/lib/api/knowledge-source-client";
import type {
  GenerationAngle,
  PublicGeneration,
  PublicDraft,
  PublicSourceCitation,
} from "@/lib/api/generation-client";
import { CopyDraftButton } from "@/components/dashboard/copy-draft-button";

interface DraftStudioProps {
  signalTopic: string | null;
  onAuthenticationExpired: () => void;
  generation: PublicGeneration | null;
  useKnowledge: boolean;
  onUseKnowledgeChange: (value: boolean) => void;
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
  onSchedule: (variationId: string, date: string, time: string) => void;
  onRemoveSchedule: (variationId: string) => void;
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
  onAuthenticationExpired,
  generation,
  useKnowledge,
  onUseKnowledgeChange,
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
  onSchedule,
  onRemoveSchedule,
  onGenerate,
  onRetry,
}: DraftStudioProps) {
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, { date: string; time: string }>>({});
  const [selectedSource, setSelectedSource] = useState<{
    citation: PublicSourceCitation;
    buttonKey: string;
    variationId: string;
  } | null>(null);
  const [currentSource, setCurrentSource] = useState<PublicKnowledgeSource | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const sourceRequestId = useRef(0);
  const sourceController = useRef<AbortController | null>(null);
  const sourceButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const trimmedLength = editorContent.trim().length;
  const editingVariation = generation?.variations.find(
    (variation) => variation.id === editingVariationId,
  );
  const contentValid =
    trimmedLength >= MIN_CONTENT_LENGTH && trimmedLength <= MAX_CONTENT_LENGTH;
  const contentUnchanged =
    editingVariation !== undefined && editorContent === editingVariation.content;

  useEffect(() => {
    return () => {
      sourceRequestId.current += 1;
      sourceController.current?.abort();
    };
  }, []);

  const inspectSource = useCallback(
    async (citation: PublicSourceCitation, buttonKey: string, variationId: string) => {
      const currentRequest = ++sourceRequestId.current;
      sourceController.current?.abort();
      const controller = new AbortController();
      sourceController.current = controller;
      setSelectedSource({ citation, buttonKey, variationId });
      setCurrentSource(null);
      setSourceError(null);
      setSourceLoading(true);

      try {
        const source = await getKnowledgeSource(citation.sourceId, controller.signal);
        if (currentRequest !== sourceRequestId.current) return;
        setCurrentSource(source);
      } catch (error: unknown) {
        if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
        if (currentRequest !== sourceRequestId.current) return;
        if (error instanceof ApiClientError && error.code === "AUTHENTICATION_REQUIRED") {
          onAuthenticationExpired();
          return;
        }
        if (error instanceof ApiClientError && error.code === "SOURCE_NOT_FOUND") {
          setSourceError("This source is no longer available.");
        } else {
          setSourceError("Unable to load the current source. Please try again.");
        }
      } finally {
        if (currentRequest === sourceRequestId.current) {
          setSourceLoading(false);
          if (sourceController.current === controller) sourceController.current = null;
        }
      }
    },
    [onAuthenticationExpired],
  );

  const closeSource = useCallback(() => {
    const buttonKey = selectedSource?.buttonKey;
    sourceRequestId.current += 1;
    sourceController.current?.abort();
    setSelectedSource(null);
    setCurrentSource(null);
    setSourceLoading(false);
    setSourceError(null);
    if (buttonKey) {
      window.requestAnimationFrame(() => sourceButtons.current[buttonKey]?.focus());
    }
  }, [selectedSource?.buttonKey]);

  const retrySource = useCallback(() => {
    if (!selectedSource) return;
    void inspectSource(
      selectedSource.citation,
      selectedSource.buttonKey,
      selectedSource.variationId,
    );
  }, [inspectSource, selectedSource]);

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
      {signalTopic && generation?.usedKnowledge && (
        <p className="mx-auto mt-3 max-w-2xl text-xs leading-5 text-slate-500">
          This Generation used indexed knowledge when it was created. References are supporting sources,
          not verified facts.
        </p>
      )}
      {signalTopic && (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Planned dates are manual publishing plans. Nothing publishes automatically. Your timezone:{" "}
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
      )}
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
          <label className="mx-auto mt-5 flex max-w-md items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left">
            <input
              type="checkbox"
              checked={useKnowledge}
              onChange={(event) => onUseKnowledgeChange(event.target.checked)}
              disabled={generating || mutationPending}
              className="mt-0.5 size-4 accent-indigo-600"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-800">
                Use my knowledge notes
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                Uses your indexed notes as supporting context and may add retrieval or provider cost.
              </span>
            </span>
          </label>
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
                    {(isApproved || variation.sourceCitations.length > 0) && (
                      <p className="mt-3 text-xs leading-5 text-amber-800">
                        Saving edits clears source references, resets approval to Draft, and removes the planned date.
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
                    <p className="mt-4 text-xs leading-5 text-slate-500">
                      Scheduling is available after this variation is approved.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                      {variation.content}
                    </p>
                    {variation.sourceCitations.length > 0 && (
                      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Supporting sources
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          These references provide supporting context, not verified facts.
                        </p>
                        <ul className="mt-2 space-y-1 text-sm text-slate-700">
                          {variation.sourceCitations.map((citation) => {
                            const buttonKey = `${variation.id}:${citation.chunkId}`;
                            const isSelected = selectedSource?.buttonKey === buttonKey;
                            return (
                            <li key={citation.chunkId}>
                              <button
                                ref={(element) => {
                                  sourceButtons.current[buttonKey] = element;
                                }}
                                type="button"
                                aria-expanded={isSelected}
                                aria-controls={isSelected ? "current-source-panel" : undefined}
                                onClick={() =>
                                  void inspectSource(citation, buttonKey, variation.id)
                                }
                                className="text-left font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                View current source: {citation.title} (version {citation.contentVersion})
                              </button>
                            </li>
                            );
                          })}
                        </ul>
                        {selectedSource?.variationId === variation.id && (
                          <div
                            id="current-source-panel"
                            className="mt-3 rounded-lg border border-indigo-100 bg-white p-3"
                            aria-live="polite"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h4 className="font-semibold text-slate-900">Current source</h4>
                                {currentSource && (
                                  <p className="mt-1 text-sm text-slate-700">
                                    {currentSource.title} (version {currentSource.contentVersion})
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={closeSource}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700"
                              >
                                Close
                              </button>
                            </div>
                            {sourceLoading && (
                              <p className="mt-3 text-sm text-slate-500" role="status">
                                Loading current source...
                              </p>
                            )}
                            {sourceError && (
                              <div className="mt-3" role="alert">
                                <p className="text-sm text-red-700">{sourceError}</p>
                                {sourceError !== "This source is no longer available." && (
                                  <button
                                    type="button"
                                    onClick={retrySource}
                                    className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white"
                                  >
                                    Retry
                                  </button>
                                )}
                              </div>
                            )}
                            {currentSource && !sourceLoading && !sourceError && (
                              <>
                                {currentSource.contentVersion !==
                                  selectedSource.citation.contentVersion && (
                                  <p className="mt-3 text-sm font-medium text-amber-800" role="status">
                                    This source has changed since generation. The citation refers to
                                    version {selectedSource.citation.contentVersion}; this is the
                                    current version {currentSource.contentVersion}.
                                  </p>
                                )}
                                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                                  {currentSource.content}
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
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
                      <CopyDraftButton
                        content={variation.content}
                        disabled={mutationPending}
                      />
                    </div>
                    {isApproved && (
                      <ScheduleControls
                        variationId={variation.id}
                        scheduledFor={variation.scheduledFor}
                        dateValue={scheduleInputs[variation.id]?.date ?? toLocalDateValue(variation.scheduledFor)}
                        timeValue={scheduleInputs[variation.id]?.time ?? toLocalTimeValue(variation.scheduledFor)}
                        onDateChange={(value) =>
                          setScheduleInputs((current) => ({
                            ...current,
                            [variation.id]: {
                              date: value,
                              time: current[variation.id]?.time ?? toLocalTimeValue(variation.scheduledFor),
                            },
                          }))
                        }
                        onTimeChange={(value) =>
                          setScheduleInputs((current) => ({
                            ...current,
                            [variation.id]: {
                              date: current[variation.id]?.date ?? toLocalDateValue(variation.scheduledFor),
                              time: value,
                            },
                          }))
                        }
                        onSchedule={() =>
                          onSchedule(
                            variation.id,
                            scheduleInputs[variation.id]?.date ?? toLocalDateValue(variation.scheduledFor),
                            scheduleInputs[variation.id]?.time ?? toLocalTimeValue(variation.scheduledFor),
                          )
                        }
                        onRemove={() => onRemoveSchedule(variation.id)}
                        disabled={mutationPending}
                      />
                    )}
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

function ScheduleControls({
  variationId,
  scheduledFor,
  dateValue,
  timeValue,
  onDateChange,
  onTimeChange,
  onSchedule,
  onRemove,
  disabled,
}: {
  variationId: string;
  scheduledFor: string | null;
  dateValue: string;
  timeValue: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onSchedule: () => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const localValue = dateValue && timeValue ? `${dateValue}T${timeValue}` : "";
  const parsed = localValue ? new Date(localValue) : null;
  const invalid = Boolean(dateValue || timeValue) &&
    (!dateValue || !timeValue || !parsed || Number.isNaN(parsed.getTime()));
  return (
    <div className="mt-5 rounded-lg bg-slate-50 p-4">
      <label className="text-sm font-semibold text-slate-800" htmlFor={`schedule-${variationId}`}>
        Planned date
      </label>
      <input
        id={`schedule-${variationId}`}
        type="date"
        value={dateValue}
        onChange={(event) => onDateChange(event.target.value)}
        disabled={disabled}
        className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:bg-slate-100"
      />
      <label className="mt-3 block text-sm font-semibold text-slate-800" htmlFor={`schedule-time-${variationId}`}>
        Planned time
      </label>
      <input
        id={`schedule-time-${variationId}`}
        type="time"
        value={timeValue}
        onChange={(event) => onTimeChange(event.target.value)}
        disabled={disabled}
        className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:bg-slate-100"
      />
      <p className="mt-2 text-xs text-slate-500">
        Enter the date in your local timezone. It will be saved as UTC.
      </p>
      {invalid ? (
        <p className="mt-2 text-xs text-red-600">Choose a valid future date and time.</p>
      ) : null}
      {scheduledFor && !invalid && (
        <p className="mt-2 text-xs text-slate-600">
          Saved planned date: {formatLocalDate(scheduledFor)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onSchedule}
          disabled={disabled || invalid}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scheduledFor ? "Change planned date" : "Add to calendar"}
        </button>
        {scheduledFor && (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Remove from calendar
          </button>
        )}
      </div>
    </div>
  );
}

function toLocalDateValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toLocalTimeValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLocalDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
