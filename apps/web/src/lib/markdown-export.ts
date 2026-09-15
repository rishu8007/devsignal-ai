import type {
  GenerationAngle,
  PublicDraft,
  PublicSourceCitation,
} from "@/lib/api/generation-client";

const angleLabels: Record<GenerationAngle, string> = {
  technical_depth: "Technical depth",
  learning_story: "Learning story",
  professional_impact: "Professional impact",
};

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]{}()#+.!|>~-])/g, "\\$1");
}

function formatPlannedDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeFilenamePart(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

export function buildDraftMarkdown(
  topic: string,
  draft: PublicDraft,
): string {
  const plannedDate = formatPlannedDate(draft.scheduledFor);
  const lines = [
    `# ${escapeMarkdown(topic)}`,
    "",
    `**Variation:** ${escapeMarkdown(angleLabels[draft.angle])}`,
    `**Status:** ${draft.status === "approved" ? "Approved" : "Draft"}`,
  ];

  if (plannedDate) {
    lines.push(`**Planned date (UTC):** ${escapeMarkdown(plannedDate)}`);
  }

  lines.push("", draft.content, "");

  if (draft.sourceCitations.length > 0) {
    lines.push(
      "## Supporting references",
      "",
      "References indicate provenance, not fact checking. Source text may have changed since generation.",
      "",
    );
    draft.sourceCitations.forEach((citation: PublicSourceCitation, index) => {
      lines.push(
        `${index + 1}. **${escapeMarkdown(citation.title)}**`,
        `   - Version: ${citation.contentVersion}`,
        `   - Source ID: \`${escapeMarkdown(citation.sourceId)}\``,
        `   - Chunk ID: \`${escapeMarkdown(citation.chunkId)}\``,
        `   - Offsets: ${citation.startOffset}–${citation.endOffset}`,
      );
    });
  }

  return `${lines.join("\n")}\n`;
}

export function downloadDraftMarkdown(topic: string, draft: PublicDraft): void {
  const markdown = buildDraftMarkdown(topic, draft);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const topicPart = sanitizeFilenamePart(topic);
  const anglePart = sanitizeFilenamePart(angleLabels[draft.angle]);
  const filename = [topicPart, anglePart].filter(Boolean).join("-").slice(0, 100) || "draft";

  anchor.href = url;
  anchor.download = `${filename}.md`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
