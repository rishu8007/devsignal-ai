import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { convertTopicToSignal, listRecentTopicPlans, planTopicsForUser } from "../services/topic-planning.service.js";
import { findTopicPlanningByIdAndOwner } from "../repositories/topic-planning.repository.js";

function owner(request: Request): string {
  const value = request.auth?.userId;
  if (!value) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return value;
}
export async function createTopicPlan(request: Request, response: Response) {
  response.status(201).json({ success: true, data: { run: await planTopicsForUser(owner(request), request.body) } });
}
export async function convertTopicSuggestion(request: Request, response: Response) {
  const result = await convertTopicToSignal(owner(request), String(request.params.runId), request.body);
  response.status(result.duplicate ? 200 : 201).json({ success: true, data: result });
}
export async function getTopicPlan(request: Request, response: Response) {
  const run = await findTopicPlanningByIdAndOwner(owner(request), String(request.params.runId));
  if (!run) throw new AppError(404, "TOPIC_PLAN_NOT_FOUND", "Topic planning run not found");
  response.json({ success: true, data: { run: { id: run._id.toString(), audience: run.audience, contentGoal: run.contentGoal, model: run.model, stale: run.stale, sourceVersions: run.sourceVersions, suggestions: run.suggestions, convertedSuggestionIds: run.convertedSuggestionIds, createdAt: run.createdAt, updatedAt: run.updatedAt } } });
}
export async function listTopicPlans(request: Request, response: Response) {
  const page = response.locals.topicPlansQuery.page as number;
  const limit = response.locals.topicPlansQuery.limit as number;
  response.json({ success: true, data: await listRecentTopicPlans(owner(request), page, limit) });
}
