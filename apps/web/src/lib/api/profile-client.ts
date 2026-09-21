"use client";

import { request } from "./api-client";

export interface ProfileProject {
  id: string;
  name: string;
  description: string;
  contribution: string;
  technologies: string[];
  outcomes: string;
  repositoryUrl: string;
  demoUrl: string;
}
export interface PublicProfile {
  id: string;
  revision: number;
  headline: string;
  careerSummary: string;
  skills: string[];
  targetRoles: string;
  intendedAudience: string;
  projects: ProfileProject[];
  resumeText: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProfileInput {
  headline: string; careerSummary: string; skills: string[]; targetRoles: string;
  intendedAudience: string; projects: Array<Omit<ProfileProject, "id">>; resumeText: string; expectedRevision: number;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function isProfile(value: unknown): value is PublicProfile {
  return record(value) && typeof value.id === "string" && typeof value.revision === "number" &&
    typeof value.headline === "string" && typeof value.careerSummary === "string" &&
    Array.isArray(value.skills) && value.skills.every((item) => typeof item === "string") &&
    typeof value.targetRoles === "string" && typeof value.intendedAudience === "string" &&
    typeof value.resumeText === "string" && Array.isArray(value.projects);
}
export function getProfile(): Promise<PublicProfile | null> {
  return request("/profile", { method: "GET" }, (value): value is { success: true; data: { profile: PublicProfile | null } } =>
    record(value) && value.success === true && record(value.data) && (value.data.profile === null || isProfile(value.data.profile)),
  ).then((response) => response.data.profile);
}
export function saveProfile(input: ProfileInput): Promise<PublicProfile> {
  return request("/profile", { method: "PUT", body: JSON.stringify(input) }, (value): value is { success: true; data: { profile: PublicProfile } } =>
    record(value) && value.success === true && record(value.data) && isProfile(value.data.profile),
  ).then((response) => response.data.profile);
}
export interface ProfileExportPreview { title: string; content: string; profileRevision: number; existingSource: unknown; }
function isPreview(value: unknown): value is { success: true; data: ProfileExportPreview } {
  return record(value) && value.success === true && record(value.data) && typeof value.data.title === "string" &&
    typeof value.data.content === "string" && typeof value.data.profileRevision === "number";
}
export function previewProfileKnowledge(section: "summary" | "resume" | "project", projectId?: string): Promise<ProfileExportPreview> {
  return request("/profile/knowledge/preview", { method: "POST", body: JSON.stringify(projectId ? { section, projectId } : { section }) }, isPreview).then((response) => response.data);
}
export function saveProfileKnowledge(input: { section: "summary" | "resume" | "project"; projectId?: string; expectedProfileRevision: number; sourceId?: string; expectedContentVersion?: number; acknowledgeLocalEdits?: boolean }) {
  return request("/profile/knowledge", { method: "POST", body: JSON.stringify(input) }, (value): value is { success: true; data: { source: unknown } } =>
    record(value) && value.success === true && record(value.data) && record(value.data.source),
  ).then((response) => response.data);
}
