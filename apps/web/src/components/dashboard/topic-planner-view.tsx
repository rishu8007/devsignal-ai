"use client";

import { useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { listKnowledgeSources, type PublicKnowledgeSource } from "@/lib/api/knowledge-source-client";
import {
  convertTopicSuggestion,
  createTopicPlan,
  listTopicPlans,
  type TopicPlan,
  type TopicSuggestion,
} from "@/lib/api/topic-planning-client";

const NOTES_MIN = 30;
const NOTES_MAX = 4000;
const TITLE_MIN = 5;
const TITLE_MAX = 120;

type Draft = { title: string; notes: string };

function initialDraft(suggestion: TopicSuggestion): Draft {
  return {
    title: suggestion.title,
    notes: `${suggestion.angle}\n\n${suggestion.relevance}\n\n${suggestion.talkingPoints.join("\n")}`,
  };
}

export function TopicPlannerView({ active }: { active: boolean }) {
  const [sources, setSources] = useState<PublicKnowledgeSource[]>([]);
  const [plans, setPlans] = useState<TopicPlan[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<TopicPlan | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conversionPending, setConversionPending] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    void Promise.all([
      listKnowledgeSources({ page: 1, limit: 20, processingStatus: "indexed" }),
      listTopicPlans(1, 10),
    ]).then(([sourceResult, planResult]) => {
      setSources(sourceResult.sources);
      setPlans(planResult.runs);
    }).catch(() => setMessage("Unable to load indexed sources or saved plans."));
  }, [active]);

  if (!active) return null;

  function selectPlan(saved: TopicPlan) {
    setPlan(saved);
    setDrafts((current) => {
      const next = { ...current };
      saved.suggestions.forEach((suggestion) => {
        if (!next[suggestion.id]) next[suggestion.id] = initialDraft(suggestion);
      });
      return next;
    });
    setMessage(null);
  }

  async function generate() {
    setPending(true);
    setMessage(null);
    try {
      const next = await createTopicPlan({
        requestId: crypto.randomUUID(),
        sourceIds: selected,
        audience,
        contentGoal: goal,
      });
      selectPlan(next);
      setPlans((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "REQUEST_ABORTED") return;
      setMessage("Unable to generate topic ideas. Your edits were preserved.");
    } finally {
      setPending(false);
    }
  }

  async function convert(suggestion: TopicSuggestion) {
    const draft = drafts[suggestion.id] ?? initialDraft(suggestion);
    if (draft.title.trim().length < TITLE_MIN || draft.title.trim().length > TITLE_MAX ||
        draft.notes.trim().length < NOTES_MIN || draft.notes.trim().length > NOTES_MAX) {
      setMessage(`Signal title must be ${TITLE_MIN}-${TITLE_MAX} characters and learning notes must be ${NOTES_MIN}-${NOTES_MAX} characters.`);
      return;
    }
    if (!plan) return;
    setConversionPending(suggestion.id);
    setMessage(null);
    try {
      await convertTopicSuggestion(plan.id, {
        suggestionId: suggestion.id,
        topic: draft.title.trim(),
        notes: draft.notes.trim(),
        primaryAudience: "Developers & engineers",
        contentType: "Technical insight",
      });
      setMessage("Signal created. Draft generation and indexing remain separate actions.");
      setPlan((current) => current ? { ...current, convertedSuggestionIds: [...new Set([...current.convertedSuggestionIds, suggestion.id])] } : current);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "TOPIC_PLAN_STALE") {
        setMessage("Knowledge changed. Your edited Signal content is preserved; create a fresh plan before converting.");
      } else {
        setMessage("Unable to create the Signal. Your edited content was preserved.");
      }
    } finally {
      setConversionPending(null);
    }
  }

  return (
    <section className="mt-8 space-y-6" aria-label="Topic planner">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Topic planner</h2>
        <p className="mt-1 text-sm text-slate-600">Generate grounded ideas only from the Knowledge sources you select.</p>
      </div>
      {plans.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-medium">Recent plans</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {plans.map((saved) => (
              <button key={saved.id} type="button" onClick={() => selectPlan(saved)} className="rounded border px-3 py-2 text-left text-sm">
                {new Date(saved.createdAt).toLocaleString()} — {saved.status}
                {saved.stale ? " · stale" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <fieldset>
          <legend className="font-medium">Indexed sources (select 1–5)</legend>
          {sources.length === 0 && <p className="mt-2 text-sm text-slate-500">No indexed sources are available.</p>}
          {sources.map((source) => (
            <label key={source.id} className="mt-2 flex gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(source.id)}
                disabled={!selected.includes(source.id) && selected.length >= 5}
                onChange={() => setSelected((items) => items.includes(source.id) ? items.filter((id) => id !== source.id) : [...items, source.id])} />
              {source.title}
            </label>
          ))}
        </fieldset>
        <input className="w-full rounded border p-2" placeholder="Intended audience (optional)" value={audience} onChange={(event) => setAudience(event.target.value)} />
        <input className="w-full rounded border p-2" placeholder="Content goal (optional)" value={goal} onChange={(event) => setGoal(event.target.value)} />
        <button type="button" disabled={pending || selected.length === 0} onClick={() => void generate()} className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">
          {pending ? "Generating…" : "Generate ideas"}
        </button>
      </div>
      {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
      {plan?.status === "running" && <p className="text-amber-700">This plan is still running. Reload will not start another provider request.</p>}
      {plan?.status === "uncertain" && <p role="alert" className="text-amber-700">The provider outcome is uncertain. No automatic retry was made.</p>}
      {plan?.status === "failed" && <p role="alert" className="text-red-700">This saved plan failed and was not retried automatically.</p>}
      {plan?.stale && <p role="alert" className="text-amber-700">Evidence changed during planning. Create a fresh plan before converting.</p>}
      {plan?.suggestions.map((suggestion) => {
        const draft = drafts[suggestion.id] ?? initialDraft(suggestion);
        const converted = plan.convertedSuggestionIds.includes(suggestion.id);
        return (
          <article key={suggestion.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <label className="block text-sm font-medium">Signal topic
              <input className="mt-1 w-full rounded border p-2" maxLength={TITLE_MAX} value={draft.title}
                onChange={(event) => setDrafts((items) => ({ ...items, [suggestion.id]: { ...draft, title: event.target.value } }))} />
            </label>
            <label className="block text-sm font-medium">Signal learning notes
              <textarea className="mt-1 min-h-36 w-full rounded border p-2" maxLength={NOTES_MAX} value={draft.notes}
                onChange={(event) => setDrafts((items) => ({ ...items, [suggestion.id]: { ...draft, notes: event.target.value } }))} />
            </label>
            <p className="text-xs text-slate-500">Exactly saved: the title above, these learning notes, audience “Developers &amp; engineers”, and content type “Technical insight”.</p>
            <p className="text-xs text-slate-500">AI supporting context only: {suggestion.sourceIds.join(", ")}. Your edited notes are not automatically evidence-verified.</p>
            <button type="button" disabled={converted || conversionPending === suggestion.id || plan.stale || plan.status !== "succeeded"} onClick={() => void convert(suggestion)} className="rounded border px-3 py-2 text-sm disabled:opacity-50">
              {converted ? "Signal created" : conversionPending === suggestion.id ? "Creating…" : "Create Signal"}
            </button>
          </article>
        );
      })}
    </section>
  );
}
