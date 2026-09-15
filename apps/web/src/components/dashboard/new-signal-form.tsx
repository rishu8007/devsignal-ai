"use client";

import { ChevronDown, Edit3 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import type { SignalPayload, SignalUpdatePayload } from "@/lib/api/signal-client";
import type { PublicSignal } from "@/lib/api/signal-client";
import {
  CONTENT_TYPES,
  LEARNING_NOTES_MAX_LENGTH,
  PRIMARY_AUDIENCES,
  TOPIC_MAX_LENGTH,
  type SignalFormValues,
  type SignalValidationErrors,
  validateSignalForm,
} from "@/lib/validation/signal-form";

const initialValues: SignalFormValues = {
  topic: "",
  learningNotes: "",
  contentType: "Project update",
  primaryAudience: "Recruiters & hiring teams",
};

type FieldName = keyof SignalFormValues;
type TouchedFields = Partial<Record<FieldName, boolean>>;

interface NewSignalFormProps {
  onCreate: (payload: SignalPayload) => Promise<boolean | undefined>;
  pending: boolean;
}

export function NewSignalForm({ onCreate, pending }: NewSignalFormProps) {
  const [values, setValues] = useState<SignalFormValues>(initialValues);
  const [touched, setTouched] = useState<TouchedFields>({});
  const [backendErrors, setBackendErrors] = useState<SignalValidationErrors>({});
  const [submissionMessage, setSubmissionMessage] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const errors = { ...validateSignalForm(values), ...backendErrors };
  const isValid = !Object.values(errors).some((message) => Boolean(message));

  function updateField<Field extends FieldName>(field: Field, value: SignalFormValues[Field]) {
    setValues((currentValues) => ({ ...currentValues, [field]: value }));
    setBackendErrors((currentErrors) => {
      const remainingErrors = { ...currentErrors };
      delete remainingErrors[field];
      return remainingErrors;
    });
    setSubmissionMessage("");
    setSubmissionError("");
  }

  function markTouched(field: FieldName) {
    setTouched((currentTouched) => ({ ...currentTouched, [field]: true }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ topic: true, learningNotes: true, contentType: true, primaryAudience: true });
    setSubmissionMessage("");
    setSubmissionError("");
    const clientErrors = validateSignalForm(values);
    if (Object.keys(clientErrors).length > 0 || pending) return;

    try {
      const saved = await onCreate({
        topic: values.topic,
        notes: values.learningNotes,
        primaryAudience: values.primaryAudience,
        contentType: values.contentType,
      });
      if (saved) {
        setValues(initialValues);
        setTouched({});
        setBackendErrors({});
        setSubmissionMessage("Signal saved successfully");
      }
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.code === "VALIDATION_ERROR") {
        const fields = error.details?.fields ?? {};
        setBackendErrors({
          topic: fields.topic?.[0],
          learningNotes: fields.notes?.[0],
          primaryAudience: fields.primaryAudience?.[0],
          contentType: fields.contentType?.[0],
        });
        setSubmissionError("Please review the highlighted fields.");
      } else if (error instanceof ApiClientError && error.code !== "AUTHENTICATION_REQUIRED") {
        setSubmissionError("Unable to save this signal right now. Please try again.");
      }
    }
  }

  return (
    <section aria-labelledby="new-signal-heading" className="relative mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="h-1 bg-gradient-to-r from-indigo-500 via-cyan-400 to-teal-400" aria-hidden="true" />
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">New signal</p>
            <h2 id="new-signal-heading" className="mt-2 text-xl font-semibold text-slate-900">What did you work on?</h2>
          </div>
          <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" aria-label="Edit new signal">
            <Edit3 className="size-4" aria-hidden="true" />
          </button>
        </div>
        <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
          <TextField id="topic" label="Topic or feature" value={values.topic} error={touched.topic ? errors.topic : undefined} onChange={(value) => updateField("topic", value)} onBlur={() => markTouched("topic")} maxLength={TOPIC_MAX_LENGTH} />
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="learning-notes" className="block text-base font-medium text-slate-700">Learning notes</label>
              <span className="text-sm text-slate-400">{values.learningNotes.length.toLocaleString()}/{LEARNING_NOTES_MAX_LENGTH.toLocaleString()}</span>
            </div>
            <textarea id="learning-notes" name="learning-notes" rows={5} value={values.learningNotes} maxLength={LEARNING_NOTES_MAX_LENGTH} onChange={(event) => updateField("learningNotes", event.target.value)} onBlur={() => markTouched("learningNotes")} aria-invalid={Boolean(touched.learningNotes && errors.learningNotes)} aria-describedby={touched.learningNotes && errors.learningNotes ? "learning-notes-error" : undefined} placeholder="Describe the problem, your approach, tools used, result, and one lesson. The more specific you are, the more credible your posts will be." className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-base leading-6 text-slate-900 placeholder:text-slate-400" />
            {touched.learningNotes && errors.learningNotes && <p id="learning-notes-error" className="mt-2 text-sm text-red-700">{errors.learningNotes}</p>}
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <SelectField id="content-type" label="Content type" value={values.contentType} options={CONTENT_TYPES} error={errors.contentType} touched={Boolean(touched.contentType)} onChange={(value) => updateField("contentType", value)} onBlur={() => markTouched("contentType")} />
            <SelectField id="audience" label="Primary audience" value={values.primaryAudience} options={PRIMARY_AUDIENCES} error={errors.primaryAudience} touched={Boolean(touched.primaryAudience)} onChange={(value) => updateField("primaryAudience", value)} onBlur={() => markTouched("primaryAudience")} />
          </div>
          <button type="submit" disabled={!isValid || pending} className={`inline-flex w-full items-center justify-center rounded-lg px-4 py-3 text-base font-semibold transition-colors sm:w-auto ${isValid && !pending ? "bg-indigo-600 text-white hover:bg-indigo-700" : "cursor-not-allowed bg-slate-200 text-slate-500"}`}>
            {pending ? "Saving signal..." : "Save signal"}
          </button>
          <p aria-live="polite" className="text-sm font-medium text-teal-700">{submissionMessage}</p>
          {submissionError && <p role="alert" className="text-sm font-medium text-red-700">{submissionError}</p>}
        </form>
      </div>
    </section>
  );
}

function TextField({ id, label, value, error, onChange, onBlur, maxLength }: { id: string; label: string; value: string; error?: string; onChange: (value: string) => void; onBlur: () => void; maxLength: number }) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-medium text-slate-700">{label}</label>
      <input id={id} name={id} type="text" value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} placeholder="e.g. Adding hybrid search to my RAG application" className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-900 placeholder:text-slate-400" />
      {error && <p id={errorId} className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

interface SelectFieldProps<Option extends string> {
  id: string;
  label: string;
  value: Option;
  options: readonly Option[];
  error?: string;
  touched: boolean;
  onChange: (value: Option) => void;
  onBlur: () => void;
}

function SelectField<Option extends string>({ id, label, value, options, error, touched, onChange, onBlur }: SelectFieldProps<Option>) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-medium text-slate-700">{label}</label>
      <div className="relative">
        <select id={id} name={id} value={value} onChange={(event) => { const selected = options.find((option) => option === event.target.value); if (selected) onChange(selected); }} onBlur={onBlur} aria-invalid={touched && Boolean(error)} aria-describedby={touched && error ? errorId : undefined} className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3.5 py-3 pr-10 text-base text-slate-800">
          {options.map((option) => <option key={option}>{option}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      </div>
      {touched && error && <p id={errorId} className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

interface EditSignalFormProps {
  signal: PublicSignal;
  pending: boolean;
  onSave: (payload: SignalUpdatePayload) => Promise<boolean>;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

export function EditSignalForm({ signal, pending, onSave, onCancel, onDirtyChange }: EditSignalFormProps) {
  const [values, setValues] = useState<SignalFormValues>(() => ({
    topic: signal.topic,
    learningNotes: signal.notes,
    contentType: signal.contentType,
    primaryAudience: signal.primaryAudience,
  }));
  const [touched, setTouched] = useState<TouchedFields>({});
  const [error, setError] = useState("");
  const dirty = values.topic !== signal.topic || values.learningNotes !== signal.notes ||
    values.contentType !== signal.contentType || values.primaryAudience !== signal.primaryAudience;
  const errors = validateSignalForm(values);
  const isValid = Object.keys(errors).length === 0;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ topic: true, learningNotes: true, contentType: true, primaryAudience: true });
    if (!isValid || !dirty || pending) return;
    try {
      await onSave({ topic: values.topic, notes: values.learningNotes, primaryAudience: values.primaryAudience, contentType: values.contentType, expectedRevision: signal.revision });
    } catch (caught: unknown) {
      if (caught instanceof ApiClientError && caught.code === "SIGNAL_VERSION_CONFLICT") setError("This Signal changed elsewhere. Reload it before editing again.");
      else if (caught instanceof ApiClientError && caught.code === "SIGNAL_GENERATION_EXISTS") setError("This Signal already has saved drafts and can no longer be edited.");
      else if (caught instanceof ApiClientError && caught.code === "SIGNAL_GENERATION_IN_PROGRESS") setError("Draft generation is using this Signal. Wait for it to finish.");
      else if (!(caught instanceof ApiClientError && caught.code === "AUTHENTICATION_REQUIRED")) setError("Unable to update this Signal. Please try again.");
    }
  }

  return (
    <section aria-labelledby="edit-signal-heading" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm sm:p-7">
      <h2 id="edit-signal-heading" className="text-xl font-semibold text-slate-900">Edit Signal</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Edit before generating drafts. Existing saved drafts are not modified.</p>
      <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
        <TextField id="edit-topic" label="Topic or feature" value={values.topic} error={touched.topic ? errors.topic : undefined} onChange={(value) => setValues((current) => ({ ...current, topic: value }))} onBlur={() => setTouched((current) => ({ ...current, topic: true }))} maxLength={TOPIC_MAX_LENGTH} />
        <div>
          <label htmlFor="edit-learning-notes" className="mb-2 block text-base font-medium text-slate-700">Learning notes</label>
          <textarea id="edit-learning-notes" value={values.learningNotes} maxLength={LEARNING_NOTES_MAX_LENGTH} rows={5} onChange={(event) => setValues((current) => ({ ...current, learningNotes: event.target.value }))} onBlur={() => setTouched((current) => ({ ...current, learningNotes: true }))} className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-base leading-6 text-slate-900" />
          <span className="text-sm text-slate-400">{values.learningNotes.length.toLocaleString()}/{LEARNING_NOTES_MAX_LENGTH.toLocaleString()}</span>
          {touched.learningNotes && errors.learningNotes && <p className="mt-2 text-sm text-red-700">{errors.learningNotes}</p>}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <SelectField id="edit-content-type" label="Content type" value={values.contentType} options={CONTENT_TYPES} error={errors.contentType} touched={Boolean(touched.contentType)} onChange={(value) => setValues((current) => ({ ...current, contentType: value }))} onBlur={() => setTouched((current) => ({ ...current, contentType: true }))} />
          <SelectField id="edit-audience" label="Primary audience" value={values.primaryAudience} options={PRIMARY_AUDIENCES} error={errors.primaryAudience} touched={Boolean(touched.primaryAudience)} onChange={(value) => setValues((current) => ({ ...current, primaryAudience: value }))} onBlur={() => setTouched((current) => ({ ...current, primaryAudience: true }))} />
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={!isValid || !dirty || pending} className="rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{pending ? "Saving changes..." : "Save Signal changes"}</button>
          <button type="button" onClick={onCancel} disabled={pending} className="rounded-lg border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
        </div>
        {error && <p className="text-sm font-medium text-red-700" role="alert">{error}</p>}
      </form>
    </section>
  );
}
