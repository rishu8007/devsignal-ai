import { z } from "zod";
export const githubRepositoriesSchema = z.object({ repositoryIds: z.array(z.number().int().positive()).min(1).max(50) }).strict();
export const githubActivityQuerySchema = z.object({ kind: z.enum(["commit", "pull_request", "release"]).optional(), repositoryId: z.coerce.number().int().positive().optional(), page: z.coerce.number().int().min(1).max(100).default(1) }).strict();
export const githubActivityParamsSchema = z.object({ activityId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
