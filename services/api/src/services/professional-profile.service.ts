import { Types } from "mongoose";
import { createHash } from "node:crypto";
import { AppError } from "../errors/app-error.js";
import type { ProfessionalProfileDocument } from "../models/professional-profile.model.js";
import { findProfessionalProfile, saveProfessionalProfile } from "../repositories/professional-profile.repository.js";
import { createProfileKnowledgeSource, findProfileKnowledgeSource } from "../repositories/professional-profile-knowledge.repository.js";
import type { ProfessionalProfileInput, ProfileKnowledgePreviewInput, ProfileKnowledgeSaveInput } from "../validation/professional-profile.validation.js";
import { toPublicKnowledgeSourceDto, type PublicKnowledgeSourceDto } from "./knowledge-source.service.js";

export interface PublicProfessionalProfile {
  id: string;
  revision: number;
  headline: string;
  careerSummary: string;
  skills: string[];
  targetRoles: string;
  intendedAudience: string;
  projects: Array<{
    id: string;
    name: string;
    description: string;
    contribution: string;
    technologies: string[];
    outcomes: string;
    repositoryUrl: string;
    demoUrl: string;
  }>;
  resumeText: string;
  createdAt: Date;
  updatedAt: Date;
}

function ownerIdValid(ownerId: string): void {
  if (!Types.ObjectId.isValid(ownerId)) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
}

function toPublicProfile(profile: ProfessionalProfileDocument): PublicProfessionalProfile {
  return {
    id: profile._id.toString(),
    revision: profile.revision,
    headline: profile.headline,
    careerSummary: profile.careerSummary,
    skills: profile.skills,
    targetRoles: profile.targetRoles,
    intendedAudience: profile.intendedAudience,
    projects: profile.projects.map((project) => ({
      id: project._id.toString(),
      name: project.name,
      description: project.description,
      contribution: project.contribution,
      technologies: project.technologies,
      outcomes: project.outcomes,
      repositoryUrl: project.repositoryUrl,
      demoUrl: project.demoUrl,
    })),
    resumeText: profile.resumeText,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export async function getProfessionalProfile(ownerId: string): Promise<PublicProfessionalProfile | null> {
  ownerIdValid(ownerId);
  const profile = await findProfessionalProfile(ownerId);
  return profile ? toPublicProfile(profile) : null;
}

export async function saveProfessionalProfileForUser(ownerId: string, input: ProfessionalProfileInput): Promise<PublicProfessionalProfile> {
  ownerIdValid(ownerId);
  try {
    const profile = await saveProfessionalProfile(ownerId, input);
    if (!profile) throw new AppError(409, "PROFILE_REVISION_CONFLICT", "Profile changed; reload before saving");
    return toPublicProfile(profile);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && /duplicate|E11000/i.test(error.message)) {
      throw new AppError(409, "PROFILE_REVISION_CONFLICT", "Profile changed; reload before saving");
    }
    throw error;
  }
}

export function buildProfileKnowledgeContent(profile: PublicProfessionalProfile, input: ProfileKnowledgePreviewInput): { title: string; content: string; projectId?: string } {
  if (input.section === "summary") return { title: "Professional profile summary", content: [profile.headline, profile.careerSummary, `Skills: ${profile.skills.join(", ")}`, `Target roles: ${profile.targetRoles}`, `Intended audience: ${profile.intendedAudience}`].filter(Boolean).join("\n\n") };
  if (input.section === "resume") return { title: "Professional resume", content: profile.resumeText };
  const project = profile.projects.find((item) => item.id === input.projectId);
  if (!project) throw new AppError(404, "PROFILE_PROJECT_NOT_FOUND", "Profile project not found");
  return { title: `Project: ${project.name}`, projectId: project.id, content: [project.description, `Personal contribution: ${project.contribution}`, `Technologies: ${project.technologies.join(", ")}`, `Outcomes: ${project.outcomes}`, project.repositoryUrl && `Repository: ${project.repositoryUrl}`, project.demoUrl && `Demo: ${project.demoUrl}`].filter(Boolean).join("\n\n") };
}

function profileSourceMetadata(profile: PublicProfessionalProfile, input: ProfileKnowledgePreviewInput) {
  return { profileId: profile.id, section: input.section, ...(input.projectId ? { projectId: input.projectId } : {}), profileRevision: profile.revision, contentHash: createHash("sha256").update(buildProfileKnowledgeContent(profile, input).content).digest("hex") };
}

export async function previewProfileKnowledge(ownerId: string, input: ProfileKnowledgePreviewInput) {
  ownerIdValid(ownerId);
  const profile = await findProfessionalProfile(ownerId);
  if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Create your professional profile first");
  const publicProfile = toPublicProfile(profile);
  const content = buildProfileKnowledgeContent(publicProfile, input);
  if (content.content.trim().length < 10 || content.content.trim().length > 20_000) throw new AppError(422, "PROFILE_KNOWLEDGE_LIMIT", "This profile section must contain 10–20,000 characters");
  const existing = await findProfileKnowledgeSource(ownerId, publicProfile.id, input.section, input.projectId);
  return { title: content.title, content: content.content, profileRevision: publicProfile.revision, existingSource: existing ? toPublicKnowledgeSourceDto(existing) : null };
}

export async function saveProfileKnowledge(ownerId: string, input: ProfileKnowledgeSaveInput): Promise<{ source: PublicKnowledgeSourceDto; unchanged: boolean }> {
  ownerIdValid(ownerId);
  const profile = await findProfessionalProfile(ownerId);
  if (!profile || profile.revision !== input.expectedProfileRevision) throw new AppError(409, "PROFILE_REVISION_CONFLICT", "Profile changed; reload before exporting it");
  const publicProfile = toPublicProfile(profile);
  const content = buildProfileKnowledgeContent(publicProfile, input);
  if (content.content.trim().length < 10 || content.content.trim().length > 20_000) throw new AppError(422, "PROFILE_KNOWLEDGE_LIMIT", "This profile section must contain 10–20,000 characters");
  const existing = await findProfileKnowledgeSource(ownerId, publicProfile.id, input.section, input.projectId);
  if (existing && !input.sourceId) return { source: toPublicKnowledgeSourceDto(existing), unchanged: true };
  if (!existing) {
    const source = await createProfileKnowledgeSource(ownerId, { title: content.title, content: content.content, profile: profileSourceMetadata(publicProfile, input) });
    return { source: toPublicKnowledgeSourceDto(source), unchanged: false };
  }
  if (input.sourceId !== existing._id.toString()) throw new AppError(409, "PROFILE_SOURCE_CONFLICT", "Review the existing note before updating it");
  if (existing.content === content.content && existing.title === content.title) return { source: toPublicKnowledgeSourceDto(existing), unchanged: true };
  const currentHash = createHash("sha256").update(existing.content).digest("hex");
  if (!input.acknowledgeLocalEdits && currentHash !== existing.profile?.contentHash) throw new AppError(409, "PROFILE_SOURCE_REVIEW_REQUIRED", "Review the current note before replacing it");
  if (!input.expectedContentVersion) throw new AppError(400, "VALIDATION_ERROR", "Expected content version is required to update an exported note");
  const { updateKnowledgeSourceIfVersionAndLeaseAvailable } = await import("../repositories/knowledge-source.repository.js");
  const updated = await updateKnowledgeSourceIfVersionAndLeaseAvailable(ownerId, existing._id.toString(), { title: content.title, content: content.content, expectedContentVersion: input.expectedContentVersion }, new Date());
  if (!updated) throw new AppError(409, "SOURCE_VERSION_CONFLICT", "The note changed or is being indexed; reload before updating");
  return { source: toPublicKnowledgeSourceDto(updated), unchanged: false };
}
