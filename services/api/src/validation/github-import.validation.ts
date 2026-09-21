import { z } from "zod";

export const githubRepositoryUrlSchema = z.string().url().max(2048);
export const githubPreviewSchema = z.object({
  repositoryUrl: githubRepositoryUrlSchema,
  branch: z.string().trim().max(255).optional(),
}).strict();

export const githubFileSchema = z.object({
  previewToken: z.string().min(20).max(200),
  path: z.string().min(1).max(1024),
}).strict();

export const githubImportSchema = githubFileSchema.extend({
  title: z.string().trim().min(1).max(120),
});

export const githubRefreshSchema = z.object({
  expectedContentVersion: z.number().int().positive(),
  acknowledgeLocalEdits: z.boolean(),
}).strict();

export type GithubPreviewInput = z.infer<typeof githubPreviewSchema>;
export type GithubFileInput = z.infer<typeof githubFileSchema>;
export type GithubImportInput = z.infer<typeof githubImportSchema>;
export type GithubRefreshInput = z.infer<typeof githubRefreshSchema>;
