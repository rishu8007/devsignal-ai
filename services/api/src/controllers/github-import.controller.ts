import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import {
  checkGithubRefresh,
  importGithubFile,
  previewGithubRepository,
  readGithubPreviewFile,
  refreshGithubSource,
} from "../services/github-import.service.js";
import type { GithubFileInput, GithubImportInput, GithubPreviewInput, GithubRefreshInput } from "../validation/github-import.validation.js";
import { toPublicKnowledgeSourceDto } from "../services/knowledge-source.service.js";

function owner(request: Request): string {
  const value = request.auth?.userId;
  if (!value) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return value;
}

export async function previewGithub(request: Request, response: Response): Promise<void> {
  response.status(200).json({ success: true, data: await previewGithubRepository(owner(request), request.body as GithubPreviewInput) });
}

export async function readGithubFile(request: Request, response: Response): Promise<void> {
  const input = request.body as GithubFileInput;
  response.status(200).json({ success: true, data: await readGithubPreviewFile(owner(request), input.previewToken, input.path) });
}

export async function importGithub(request: Request, response: Response): Promise<void> {
  const result = await importGithubFile(owner(request), request.body as GithubImportInput);
  response.status(result.unchanged ? 200 : 201).json({ success: true, data: result });
}

export async function checkGithub(request: Request, response: Response): Promise<void> {
  const result = await checkGithubRefresh(owner(request), String(request.params.sourceId));
  response.status(200).json({ success: true, data: { ...result, source: toPublicKnowledgeSourceDto(result.source) } });
}

export async function refreshGithub(request: Request, response: Response): Promise<void> {
  response.status(200).json({ success: true, data: await refreshGithubSource(owner(request), String(request.params.sourceId), request.body as GithubRefreshInput) });
}
