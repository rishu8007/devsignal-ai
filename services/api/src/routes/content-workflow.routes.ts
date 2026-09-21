import { Router } from "express";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateParams, validateRequest } from "../middleware/validate-request.middleware.js";
import { approveContentWorkflow, cancelContentWorkflow, getContentWorkflow, listContentWorkflows, startContentWorkflow } from "../controllers/content-workflow.controller.js";
import { approvalSchema, startWorkflowSchema, workflowDetailParamsSchema, workflowSignalParamsSchema } from "../validation/content-workflow.validation.js";

export const contentWorkflowRouter = Router({ mergeParams: true });
contentWorkflowRouter.get("/", authenticationMiddleware, validateParams(workflowSignalParamsSchema, (locals, params) => { locals.signalId = params.signalId; }), listContentWorkflows);
contentWorkflowRouter.post("/", authenticationMiddleware, validateParams(workflowSignalParamsSchema, (locals, params) => { locals.signalId = params.signalId; }), validateRequest(startWorkflowSchema), startContentWorkflow);
contentWorkflowRouter.get("/:workflowId", authenticationMiddleware, validateParams(workflowDetailParamsSchema, (locals, params) => { locals.signalId = params.signalId; locals.workflowId = params.workflowId; }), getContentWorkflow);
contentWorkflowRouter.post("/:workflowId/cancel", authenticationMiddleware, validateParams(workflowDetailParamsSchema, (locals, params) => { locals.signalId = params.signalId; locals.workflowId = params.workflowId; }), cancelContentWorkflow);
contentWorkflowRouter.post("/:workflowId/approve", authenticationMiddleware, validateParams(workflowDetailParamsSchema, (locals, params) => { locals.signalId = params.signalId; locals.workflowId = params.workflowId; }), validateRequest(approvalSchema), approveContentWorkflow);
