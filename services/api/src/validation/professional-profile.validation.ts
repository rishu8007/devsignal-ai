import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max);
const url = z.string().trim().url().max(2048);

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(2000),
  contribution: optionalText(2000),
  technologies: z.array(z.string().trim().min(1).max(80)).max(30),
  outcomes: optionalText(2000),
  repositoryUrl: url.or(z.literal("")),
  demoUrl: url.or(z.literal("")),
}).strict();

export const professionalProfileInputSchema = z.object({
  headline: optionalText(160),
  careerSummary: optionalText(5000),
  skills: z.array(z.string().trim().min(1).max(80)).max(50),
  targetRoles: optionalText(1000),
  intendedAudience: optionalText(1000),
  projects: z.array(projectSchema).max(20),
  resumeText: optionalText(30000),
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export const profileKnowledgePreviewSchema = z.object({
  section: z.enum(["summary", "resume", "project"]),
  projectId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
}).strict();

export const profileKnowledgeSaveSchema = profileKnowledgePreviewSchema.extend({
  expectedProfileRevision: z.number().int().positive(),
  sourceId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  expectedContentVersion: z.number().int().positive().optional(),
  acknowledgeLocalEdits: z.boolean().default(false),
}).strict();

export type ProfessionalProfileInput = z.infer<typeof professionalProfileInputSchema>;
export type ProfileKnowledgePreviewInput = z.infer<typeof profileKnowledgePreviewSchema>;
export type ProfileKnowledgeSaveInput = z.infer<typeof profileKnowledgeSaveSchema>;
