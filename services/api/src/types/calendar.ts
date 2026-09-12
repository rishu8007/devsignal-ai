import type { GenerationAngle } from "./generation.js";

export interface CalendarItem {
  id: string;
  generationId: string;
  signalId: string;
  topic: string;
  angle: GenerationAngle;
  content: string;
  status: "approved";
  scheduledFor: Date;
}

export interface CalendarResult {
  items: CalendarItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
