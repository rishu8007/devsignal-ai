import type {
  SignalContentType,
  SignalPrimaryAudience,
} from "../constants/signal.constants.js";

export const GENERATION_ANGLES = [
  "technical_depth",
  "learning_story",
  "professional_impact",
] as const;

export type GenerationAngle = (typeof GENERATION_ANGLES)[number];

export interface GenerationSource {
  topic: string;
  notes: string;
  primaryAudience: SignalPrimaryAudience;
  contentType: SignalContentType;
}

// Sent to the AI service alongside a GenerationSource when knowledge grounding is
// requested. Only chunkId and text cross this boundary; the AI service is never given
// sourceId, title, or any owner-identifying metadata.
export interface GenerationContextChunk {
  chunkId: string;
  text: string;
}

export interface AiGenerationVariation {
  angle: GenerationAngle;
  content: string;
  citations: string[];
}

export interface AiGenerationResult {
  model: string;
  variations: AiGenerationVariation[];
  usage?: {
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    embeddingTokens: number | null;
  } | undefined;
}

// Server-owned citation metadata mapped from a model-returned chunkId. Never derived
// from client input; always looked up from the API's own MongoDB-validated candidates.
export interface PublicSourceCitation {
  sourceId: string;
  title: string;
  contentVersion: number;
  chunkId: string;
  startOffset: number;
  endOffset: number;
}

// The variation shape after citations have been mapped from raw model chunkIds to
// server-owned citation metadata, ready for persistence.
export interface MappedGenerationVariation {
  angle: GenerationAngle;
  content: string;
  citations: PublicSourceCitation[];
}

export interface MappedGenerationResult {
  model: string;
  usedKnowledge: boolean;
  variations: MappedGenerationVariation[];
}

export interface PublicGenerationVariation {
  id: string;
  angle: GenerationAngle;
  content: string;
  status: "draft" | "approved";
  scheduledFor: Date | null;
  sourceCitations: PublicSourceCitation[];
}

export interface PublicGenerationDto {
  id: string;
  signalId: string;
  model: string;
  usedKnowledge: boolean;
  variations: PublicGenerationVariation[];
  createdAt: Date;
  updatedAt: Date;
}
