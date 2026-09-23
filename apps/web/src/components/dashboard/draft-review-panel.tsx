import { useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { listResearchBriefs, type ResearchBrief } from "@/lib/api/research-brief-client";
import { applyDraftReview, createDraftReview, listDraftReviews, type DraftReview } from "@/lib/api/draft-review-client";
import type { PublicGeneration } from "@/lib/api/generation-client";

type ReviewFinding = DraftReview["findings"][number];

function qualityAssessment(review: DraftReview, currentContent: string) {
  if (review.status !== "succeeded" || review.stale || review.draftContentHash === "") return null;
  const unsupported = review.findings.filter((finding) => ["unsupported_personal_claim", "unsupported_technical_claim", "contradiction", "overstatement"].includes(finding.category));
  const clarity = review.findings.filter((finding) => finding.category === "clarity");
  const formatting: string[] = [];
  const length = currentContent.trim().length;
  if (length > 3000) formatting.push("Shorten the draft to 3,000 characters or fewer.");
  if (currentContent.split(/\n\s*\n/).length === 1) formatting.push("Add paragraph breaks to improve LinkedIn readability.");
  if (/(^|\s)#{1,6}\s/.test(currentContent)) formatting.push("Replace Markdown headings with plain-language LinkedIn formatting.");
  const deductions = unsupported.reduce((total, finding) => total + (finding.severity === "high" ? 20 : finding.severity === "medium" ? 10 : 5), 0)
    + clarity.reduce((total, finding) => total + (finding.severity === "high" ? 15 : finding.severity === "medium" ? 8 : 4), 0)
    + formatting.length * 5;
  return {
    score: Math.max(0, 100 - deductions),
    grounding: unsupported.length ? `${unsupported.length} grounding concern${unsupported.length === 1 ? "" : "s"}` : "No unsupported-claim findings",
    clarity: clarity.length ? `${clarity.length} clarity finding${clarity.length === 1 ? "" : "s"}` : "No clarity findings",
    formatting: formatting.length ? formatting.join(" ") : "No basic formatting concerns detected",
    suggestions: [...unsupported, ...clarity].map((finding) => finding.suggestion).filter(Boolean),
  };
}

function Finding({ finding }: { finding: ReviewFinding }) {
  return <div className="rounded-lg border border-white bg-white p-3"><p className="text-xs font-semibold uppercase text-indigo-700">{finding.severity} · {finding.category}</p><p className="mt-1 text-sm font-medium text-slate-900">“{finding.passage}”</p><p className="mt-1 text-sm text-slate-700">{finding.explanation}</p><p className="mt-1 text-sm text-slate-600">Suggestion: {finding.suggestion}</p></div>;
}

export function DraftReviewPanel({ signalId, variationId, currentContent, onApplied, onClose, onCreateResearch }: { signalId: string; variationId: string; currentContent: string; onApplied: (generation: PublicGeneration) => void; onClose: () => void; onCreateResearch: () => void }) {
  const [briefs, setBriefs] = useState<ResearchBrief[]>([]);
  const [briefId, setBriefId] = useState("");
  const [review, setReview] = useState<DraftReview | null>(null);
  const [history, setHistory] = useState<DraftReview[]>([]);
  const [proposal, setProposal] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void Promise.all([listResearchBriefs(signalId), listDraftReviews(signalId, variationId)]).then(([items, saved]) => { const current = items.filter((item) => !item.stale && (item.status === "succeeded" || item.status === "no_evidence")); setBriefs(current); setBriefId(current[0]?.id ?? ""); setHistory(saved); }).catch(() => setError("Unable to load current research briefs.")).finally(() => setLoading(false)); }, [signalId, variationId]);
  const start = async () => {
    if (!briefId) return;
    setPending(true); setError(null);
    try { const result = await createDraftReview(signalId, variationId, { requestId: crypto.randomUUID(), researchBriefId: briefId }); setReview(result); setHistory((current) => [result, ...current.filter((item) => item.id !== result.id)]); setProposal(result.proposedDraft ?? ""); } catch (value: unknown) { setError(value instanceof ApiClientError ? value.message : "Review failed. Your draft was not changed."); } finally { setPending(false); }
  };
  const apply = async () => {
    if (!review || !proposal.trim()) return;
    setPending(true); setError(null);
    try { onApplied(await applyDraftReview(signalId, variationId, review.id, { expectedContentHash: review.draftContentHash, content: proposal })); } catch (value: unknown) { setError(value instanceof ApiClientError ? value.message : "The review is stale. Your proposal was not applied."); } finally { setPending(false); }
  };
  const assessment = review ? qualityAssessment(review, currentContent) : null;
  const reviewOutdated = review ? review.stale || review.draftContent !== currentContent : false;
  return <section className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 p-5 text-left" aria-label="Technical draft review">
    <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-slate-900">Technical draft review</h3><button type="button" onClick={onClose} className="text-sm font-semibold text-slate-600">Close</button></div>
    {loading && <p className="mt-3 text-sm text-slate-600">Loading research briefs...</p>}
    {!loading && history.length > 0 && <div className="mt-3 flex flex-wrap gap-2"><span className="text-sm text-slate-600">Saved reviews:</span>{history.map((item) => <button key={item.id} type="button" onClick={() => { setReview(item); setProposal(item.proposedDraft ?? ""); }} className="text-sm font-semibold text-indigo-700">{new Date(item.createdAt).toLocaleDateString()}{item.stale ? " (stale)" : ""}</button>)}</div>}
    {!loading && !review && briefs.length === 0 && <div className="mt-3"><p className="text-sm text-slate-600">Create a current research brief for this Signal before reviewing.</p><button type="button" onClick={onCreateResearch} className="mt-3 rounded-lg border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700">Create research brief</button></div>}
    {!loading && !review && briefs.length > 0 && <div className="mt-4 flex flex-wrap gap-3"><select value={briefId} onChange={(event) => setBriefId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">{briefs.map((brief) => <option key={brief.id} value={brief.id}>{new Date(brief.createdAt).toLocaleString()}</option>)}</select><button type="button" onClick={() => void start()} disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">{pending ? "Reviewing..." : "Review draft"}</button></div>}
    {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
    {!loading && !review && <div className="mt-5 rounded-lg border border-indigo-200 bg-white p-4"><h4 className="font-semibold text-slate-900">Draft quality heuristic</h4><p className="mt-1 text-lg font-bold text-slate-500">Not assessed</p><p className="mt-1 text-xs text-slate-500">Run the existing technical review to assess factual grounding, clarity, and supported LinkedIn formatting checks.</p></div>}
    {review && <div className="mt-5 space-y-4">{reviewOutdated && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status"><strong>Not assessed for the current draft.</strong> This review belongs to an earlier content version. Request a new review before applying suggestions.</div>}{!reviewOutdated && <div className="rounded-lg border border-indigo-200 bg-white p-4" aria-label="Draft quality assessment"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="font-semibold text-slate-900">Draft quality heuristic</h4><span className="text-lg font-bold text-indigo-700">{assessment ? `${assessment.score}/100` : "Not assessed"}</span></div><p className="mt-1 text-xs text-slate-500">Deterministic advisory rubric, not a prediction of engagement and never an approval decision.</p>{assessment && <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div><dt className="font-medium text-slate-700">Factual grounding</dt><dd className="text-slate-600">{assessment.grounding}</dd></div><div><dt className="font-medium text-slate-700">Clarity</dt><dd className="text-slate-600">{assessment.clarity}</dd></div><div><dt className="font-medium text-slate-700">LinkedIn formatting</dt><dd className="text-slate-600">{assessment.formatting}</dd></div></dl>}{assessment?.suggestions.length ? <div className="mt-3"><p className="text-sm font-medium text-slate-700">Actionable improvements</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">{assessment.suggestions.map((suggestion, index) => <li key={`${suggestion}-${index}`}>{suggestion}</li>)}</ul></div> : null}</div>}<p className="text-sm text-slate-800">{review.summary}</p>{review.findings.length === 0 ? <p className="text-sm text-slate-600">No findings. This is advisory and does not approve the draft.</p> : review.findings.map((finding, index) => <Finding key={`${finding.passage}-${index}`} finding={finding} />)}{review.proposedDraft && !reviewOutdated ? <><label className="block text-sm font-semibold text-slate-800">Proposed revision — edit before applying<textarea value={proposal} onChange={(event) => setProposal(event.target.value)} className="mt-2 min-h-40 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm leading-6" /></label><p className="text-xs text-slate-600">Applying saves this text as a draft, clears approval, schedule and citations, and never calls AI again.</p><button type="button" onClick={() => void apply()} disabled={pending || proposal.trim().length < 100 || proposal.trim().length > 3000} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Applying..." : "Apply revision"}</button></> : review.proposedDraft && <p className="text-sm text-slate-600">Suggested edits are unavailable until a new review matches the current draft.</p>}</div>}
  </section>;
}
