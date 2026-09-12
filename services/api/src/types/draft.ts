import type { GenerationAngle } from "./generation.js";

export type DraftStatus = "draft" | "approved";

export interface PublicDraftListItem {
  id: string;
  generationId: string;
  signalId: string;
  topic: string;
  angle: GenerationAngle;
  content: string;
  status: DraftStatus;
  scheduledFor: Date | null;
  generationUpdatedAt: Date;
}

export interface DraftListResult {
  drafts: PublicDraftListItem[];
  total: number;
  summary: {
    draft: number;
    approved: number;
    scheduled: number;
    total: number;
  };
}
