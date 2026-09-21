import type { Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { approveContentWorkflowForUser, cancelContentWorkflowForUser, createContentWorkflowReviewForUser, getContentWorkflowForUser, listContentWorkflowsForUser, startContentWorkflowForUser } from "../services/content-workflow.service.js";

function owner(request: Request) {
  const value = request.auth?.userId;
  if (!value) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return value;
}
export async function startContentWorkflow(request: Request, response: Response): Promise<void> {
  const run = await startContentWorkflowForUser(owner(request), response.locals.signalId, request.body);
  response.status(202).json({ success: true, data: { workflow: run } });
}
export async function listContentWorkflows(request: Request, response: Response): Promise<void> {
  const workflows = await listContentWorkflowsForUser(owner(request), response.locals.signalId);
  response.status(200).json({ success: true, data: { workflows } });
}
export async function getContentWorkflow(request: Request, response: Response): Promise<void> {
  const workflow = await getContentWorkflowForUser(owner(request), response.locals.signalId, response.locals.workflowId);
  response.status(200).json({ success: true, data: { workflow } });
}
export async function createContentWorkflowReview(request: Request, response: Response): Promise<void> {
  const workflow = await createContentWorkflowReviewForUser(owner(request), response.locals.signalId, response.locals.workflowId, request.body);
  response.status(202).json({ success: true, data: { workflow } });
}
export async function cancelContentWorkflow(request: Request, response: Response): Promise<void> {
  const workflow = await cancelContentWorkflowForUser(owner(request), response.locals.signalId, response.locals.workflowId);
  response.status(200).json({ success: true, data: { workflow } });
}
export async function approveContentWorkflow(request: Request, response: Response): Promise<void> {
  const workflow = await approveContentWorkflowForUser(owner(request), response.locals.signalId, response.locals.workflowId, request.body);
  response.status(200).json({ success: true, data: { workflow } });
}
