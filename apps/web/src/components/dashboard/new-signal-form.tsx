"use client";

import { ChevronDown, Edit3 } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import {
  CONTENT_TYPES,
  LEARNING_NOTES_MAX_LENGTH,
  PRIMARY_AUDIENCES,
  TOPIC_MAX_LENGTH,
  type SignalFormValues,
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

export function NewSignalForm() {
  const [values, setValues] = useState<SignalFormValues>(initialValues);
  const [touched, setTouched] = useState<TouchedFields>({});
  const [submissionMessage, setSubmissionMessage] = useState("");
  const errors = validateSignalForm(values);
  const isValid = Object.keys(errors).length === 0;

  function updateField<Field extends FieldName>(field: Field, value: SignalFormValues[Field]) {
    setValues((currentValues) => ({ ...currentValues, [field]: value }));
    setSubmissionMessage("");
  }

  function markTouched(field: FieldName) {
    setTouched((currentTouched) => ({ ...currentTouched, [field]: true }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({
      topic: true,
      learningNotes: true,
      contentType: true,
      primaryAudience: true,
    });

    if (isValid) {
      setSubmissionMessage(
        "Your signal is ready for generation. The AI service is not connected yet.",
      );
    }
  }

  return (
    <section
      aria-labelledby="new-signal-heading"
      className="relative mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div
        className="h-1 bg-gradient-to-r from-indigo-500 via-cyan-400 to-teal-400"
        aria-hidden="true"
      />
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">
              New signal
            </p>
            <h2 id="new-signal-heading" className="mt-2 text-xl font-semibold text-slate-900">
              What did you work on?
            </h2>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Edit new signal"
          >
            <Edit3 className="size-4" aria-hidden="true" />
          </button>
        </div>
        <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="topic" className="mb-2 block text-base font-medium text-slate-700">
              Topic or feature
            </label>
            <input
              id="topic"
              name="topic"
              type="text"
              value={values.topic}
              maxLength={TOPIC_MAX_LENGTH}
              onChange={(event) => updateField("topic", event.target.value)}
              onBlur={() => markTouched("topic")}
              aria-invalid={touched.topic && Boolean(errors.topic)}
              aria-describedby={touched.topic && errors.topic ? "topic-error" : undefined}
              placeholder="e.g. Adding hybrid search to my RAG application"
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-900 placeholder:text-slate-400"
            />
            {touched.topic && errors.topic && (
              <p id="topic-error" className="mt-2 text-sm text-red-700">
                {errors.topic}
              </p>
            )}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label
                htmlFor="learning-notes"
                className="block text-base font-medium text-slate-700"
              >
                Learning notes
              </label>
              <span className="text-sm text-slate-400">
                {values.learningNotes.length.toLocaleString()}/{LEARNING_NOTES_MAX_LENGTH.toLocaleString()}
              </span>
            </div>
            <textarea
              id="learning-notes"
              name="learning-notes"
              rows={5}
              value={values.learningNotes}
              maxLength={LEARNING_NOTES_MAX_LENGTH}
              onChange={(event) => updateField("learningNotes", event.target.value)}
              onBlur={() => markTouched("learningNotes")}
              aria-invalid={touched.learningNotes && Boolean(errors.learningNotes)}
              aria-describedby={
                touched.learningNotes && errors.learningNotes ? "learning-notes-error" : undefined
              }
              placeholder="Describe the problem, your approach, tools used, result, and one lesson. The more specific your posts will be."
              className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-base leading-6 text-slate-900 placeholder:text-slate-400"
            />
            {touched.learningNotes && errors.learningNotes && (
              <p id="learning-notes-error" className="mt-2 text-sm text-red-700">
                {errors.learningNotes}
              </p>
            )}
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <SelectField
              id="content-type"
              label="Content type"
              value={values.contentType}
              options={CONTENT_TYPES}
              error={errors.contentType}
              touched={Boolean(touched.contentType)}
              onChange={(value) => updateField("contentType", value)}
              onBlur={() => markTouched("contentType")}
            />
            <SelectField
              id="audience"
              label="Primary audience"
              value={values.primaryAudience}
              options={PRIMARY_AUDIENCES}
              error={errors.primaryAudience}
              touched={Boolean(touched.primaryAudience)}
              onChange={(value) => updateField("primaryAudience", value)}
              onBlur={() => markTouched("primaryAudience")}
            />
          </div>
          <button
            type="submit"
            disabled={!isValid}
            className={`inline-flex w-full items-center justify-center rounded-lg px-4 py-3 text-base font-semibold transition-colors sm:w-auto ${
              isValid
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "cursor-not-allowed bg-slate-200 text-slate-500"
            }`}
          >
            Generate three variations
          </button>
          <p aria-live="polite" className="text-sm font-medium text-teal-700">
            {submissionMessage}
          </p>
        </form>
      </div>
    </section>
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

function SelectField<Option extends string>({
  id,
  label,
  value,
  options,
  error,
  touched,
  onChange,
  onBlur,
}: SelectFieldProps<Option>) {
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-medium text-slate-700">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          name={id}
          value={value}
          onChange={(event) => {
            const selectedOption = options.find((option) => option === event.target.value);
            if (selectedOption) {
              onChange(selectedOption);
            }
          }}
          onBlur={onBlur}
          aria-invalid={touched && Boolean(error)}
          aria-describedby={touched && error ? errorId : undefined}
          className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3.5 py-3 pr-10 text-base text-slate-800"
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
      </div>
      {touched && error && (
        <p id={errorId} className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
