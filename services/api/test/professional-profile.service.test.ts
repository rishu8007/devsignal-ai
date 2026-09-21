import assert from "node:assert/strict";
import test from "node:test";
import { professionalProfileInputSchema } from "../src/validation/professional-profile.validation.js";
import { buildProfileKnowledgeContent, getProfessionalProfile } from "../src/services/professional-profile.service.js";

const profile = {
  id: "507f1f77bcf86cd799439011",
  revision: 3,
  headline: "Backend engineer",
  careerSummary: "Builds reliable services.",
  skills: ["TypeScript", "MongoDB"],
  targetRoles: "Backend roles",
  intendedAudience: "Engineering teams",
  projects: [{
    id: "507f1f77bcf86cd799439012",
    name: "Signal",
    description: "A developer tool.",
    contribution: "Owned the API.",
    technologies: ["TypeScript"],
    outcomes: "Shipped a useful tool.",
    repositoryUrl: "https://github.com/example/signal",
    demoUrl: "",
  }],
  resumeText: "Resume text.",
  createdAt: new Date(),
  updatedAt: new Date(),
};

test("profile validation is strict and bounds project count", () => {
  assert.equal(professionalProfileInputSchema.safeParse({
    headline: "", careerSummary: "", skills: [], targetRoles: "", intendedAudience: "",
    projects: [], resumeText: "", expectedRevision: 0,
  }).success, true);
  assert.equal(professionalProfileInputSchema.safeParse({
    headline: "", careerSummary: "", skills: [], targetRoles: "", intendedAudience: "",
    projects: Array.from({ length: 21 }, () => ({ name: "x", description: "", contribution: "", technologies: [], outcomes: "", repositoryUrl: "", demoUrl: "" })),
    resumeText: "", expectedRevision: 0,
  }).success, false);
});

test("profile knowledge export derives exact selected content", () => {
  assert.deepEqual(buildProfileKnowledgeContent(profile, { section: "summary" }), {
    title: "Professional profile summary",
    content: "Backend engineer\n\nBuilds reliable services.\n\nSkills: TypeScript, MongoDB\n\nTarget roles: Backend roles\n\nIntended audience: Engineering teams",
  });
  assert.match(buildProfileKnowledgeContent(profile, { section: "project", projectId: profile.projects[0].id }).content, /Owned the API/);
});

test("profile ownership is enforced before persistence", async () => {
  await assert.rejects(getProfessionalProfile("not-an-owner"), /Authentication is required/);
});
