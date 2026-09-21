import { KnowledgeSourceModel, type KnowledgeSourceDocument } from "../models/knowledge-source.model.js";
import { Types } from "mongoose";

export function findProfileKnowledgeSource(ownerId: string, profileId: string, section: string, projectId?: string) {
  return KnowledgeSourceModel.findOne({
    ownerId,
    "profile.profileId": new Types.ObjectId(profileId),
    "profile.section": section as "summary" | "resume" | "project",
    ...(projectId ? { "profile.projectId": new Types.ObjectId(projectId) } : {}),
  }).select("_id title content contentVersion processingStatus createdAt updatedAt +profile +indexingLeaseExpiresAt").lean<KnowledgeSourceDocument>().exec();
}

export function createProfileKnowledgeSource(ownerId: string, input: {
  title: string;
  content: string;
  profile: { profileId: string; section: "summary" | "resume" | "project"; projectId?: string; profileRevision: number; contentHash: string };
}) {
  return KnowledgeSourceModel.create({
    ownerId,
    ...input,
    profile: {
      profileId: new Types.ObjectId(input.profile.profileId),
      section: input.profile.section,
      ...(input.profile.projectId ? { projectId: new Types.ObjectId(input.profile.projectId) } : {}),
      profileRevision: input.profile.profileRevision,
      contentHash: input.profile.contentHash,
    },
    contentVersion: 1,
    processingStatus: "pending",
  });
}
