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

export interface AiGenerationVariation {
  angle: GenerationAngle;
  content: string;
}

export interface AiGenerationResult {
  model: string;
  variations: AiGenerationVariation[];
}

export interface PublicGenerationVariation {
  id: string;
  angle: GenerationAngle;
  content: string;
  status: "draft";
}

export interface PublicGenerationDto {
  id: string;
  signalId: string;
  model: string;
  variations: PublicGenerationVariation[];
  createdAt: Date;
  updatedAt: Date;
}
