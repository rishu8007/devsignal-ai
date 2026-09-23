export const DRAFT_QUALITY_RUBRIC_VERSION = "1";

type Finding = {
  category: string;
  severity: string;
};

export function calculateDraftQualityScore(content: string, findings: Finding[]): number {
  const grounding = findings.filter((finding) =>
    ["unsupported_personal_claim", "unsupported_technical_claim", "contradiction", "overstatement"].includes(finding.category),
  );
  const clarity = findings.filter((finding) => finding.category === "clarity");
  const formatting =
    (content.split(/\n\s*\n/).length === 1 ? 1 : 0) +
    (/(^|\s)#{1,6}\s/.test(content) ? 1 : 0);
  const deduction = grounding.reduce((total, finding) => total + (finding.severity === "high" ? 20 : finding.severity === "medium" ? 10 : 5), 0)
    + clarity.reduce((total, finding) => total + (finding.severity === "high" ? 15 : finding.severity === "medium" ? 8 : 4), 0)
    + formatting * 5;
  return Math.max(0, 100 - deduction);
}
