import { Router } from "express";
import { authenticationMiddleware } from "../middleware/authentication.middleware.js";
import { validateParams, validateRequest } from "../middleware/validate-request.middleware.js";
import { applyDraftReview, createDraftReview, getDraftReview, listDraftReviews } from "../controllers/draft-review.controller.js";
import { applyReviewSchema, createReviewSchema, reviewDetailParamsSchema, reviewParamsSchema } from "../validation/draft-review.validation.js";

export const draftReviewRouter = Router({ mergeParams: true });
const params = validateParams(reviewParamsSchema, (locals, value) => { locals.signalId = value.signalId; locals.variationId = value.variationId; });
draftReviewRouter.get("/", authenticationMiddleware, params, listDraftReviews);
draftReviewRouter.post("/", authenticationMiddleware, params, validateRequest(createReviewSchema), createDraftReview);
draftReviewRouter.get("/:reviewId", authenticationMiddleware, validateParams(reviewDetailParamsSchema, (locals, value) => { locals.signalId = value.signalId; locals.variationId = value.variationId; }), getDraftReview);
draftReviewRouter.post("/:reviewId/apply", authenticationMiddleware, validateParams(reviewDetailParamsSchema, (locals, value) => { locals.signalId = value.signalId; locals.variationId = value.variationId; }), validateRequest(applyReviewSchema), applyDraftReview);
