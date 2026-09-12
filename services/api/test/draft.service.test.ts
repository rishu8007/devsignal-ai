import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import { Types } from "mongoose";
import { AppError } from "../src/errors/app-error.js";
import { authenticationMiddleware } from "../src/middleware/authentication.middleware.js";
import {
  listDraftsForUser,
  type DraftRepositoryBoundary,
} from "../src/services/draft.service.js";
import { listDraftsQuerySchema } from "../src/validation/draft.validation.js";

const ownerId = "507f1f77bcf86cd799439011";
const generationId = "507f1f77bcf86cd799439014";
const signalId = "507f1f77bcf86cd799439013";
const variationId = "507f1f77bcf86cd799439015";

function repositoryWithResult(
  result: Awaited<ReturnType<DraftRepositoryBoundary["listDraftsByOwner"]>>,
  calls: Array<{ ownerId: string; page: number; limit: number; status?: "draft" | "approved" }>,
): DraftRepositoryBoundary {
  return {
    listDraftsByOwner: async (currentOwnerId, page, limit, status) => {
      calls.push({ ownerId: currentOwnerId, page, limit, status });
      return result;
    },
  };
}

test("draft library rejects unauthenticated requests", () => {
  let receivedError: unknown;
  authenticationMiddleware(
    { cookies: {} } as Request,
    {} as never,
    (error?: unknown) => {
      receivedError = error;
    },
  );

  assert.ok(receivedError instanceof AppError);
  assert.equal(receivedError.code, "AUTHENTICATION_REQUIRED");
});

test("draft query validation applies defaults, status, limits, and rejects unknown fields", () => {
  assert.deepEqual(
    listDraftsQuerySchema.parse({}),
    { page: 1, limit: 20 },
  );
  assert.deepEqual(
    listDraftsQuerySchema.parse({ page: "2", limit: "50", status: "approved" }),
    { page: 2, limit: 50, status: "approved" },
  );
  assert.equal(listDraftsQuerySchema.safeParse({ limit: "51" }).success, false);
  assert.equal(listDraftsQuerySchema.safeParse({ status: "published" }).success, false);
  assert.equal(listDraftsQuerySchema.safeParse({ unexpected: "value" }).success, false);
});

test("draft library scopes repository access to the authenticated owner and status", async () => {
  const calls: Array<{ ownerId: string; page: number; limit: number; status?: "draft" | "approved" }> = [];
  const result = await listDraftsForUser(
    ownerId,
    2,
    1,
    "approved",
    repositoryWithResult(
      {
        drafts: [{
          id: variationId,
          generationId,
          signalId,
          topic: "A saved signal",
          angle: "technical_depth",
          content: "x".repeat(100),
          status: "approved",
          generationUpdatedAt: new Date("2026-09-12T00:00:00.000Z"),
        }],
        total: 1,
        summary: { draft: 2, approved: 1, scheduled: 1, total: 3 },
      },
      calls,
    ),
  );

  assert.deepEqual(calls, [{ ownerId, page: 2, limit: 1, status: "approved" }]);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.pagination.totalPages, 1);
  assert.equal(result.summary.total, 3);
  assert.deepEqual(Object.keys(result.drafts[0]).sort(), [
    "angle",
    "content",
    "generationId",
    "generationUpdatedAt",
    "id",
    "signalId",
    "status",
    "topic",
  ]);
});

test("summary is independent of selected status and page, and empty totals are zero", async () => {
  const result = await listDraftsForUser(
    ownerId,
    4,
    2,
    "draft",
    repositoryWithResult(
      {
        drafts: [],
        total: 0,
        summary: { draft: 3, approved: 2, scheduled: 1, total: 5 },
      },
      [],
    ),
  );

  assert.deepEqual(result.drafts, []);
  assert.deepEqual(result.pagination, {
    page: 4,
    limit: 2,
    total: 0,
    totalPages: 0,
  });
  assert.deepEqual(result.summary, { draft: 3, approved: 2, scheduled: 1, total: 5 });
});

test("scheduled summary is owner-scoped and independent of filter and page", async () => {
  const calls: Array<{ ownerId: string; page: number; limit: number; status?: "draft" | "approved" }> = [];
  const result = await listDraftsForUser(
    ownerId,
    9,
    1,
    "draft",
    repositoryWithResult(
      {
        drafts: [],
        total: 0,
        summary: { draft: 4, approved: 3, scheduled: 2, total: 7 },
      },
      calls,
    ),
  );

  assert.deepEqual(calls, [{ ownerId, page: 9, limit: 1, status: "draft" }]);
  assert.equal(result.summary.scheduled, 2);
  assert.equal(result.pagination.total, 0);
});

test("invalid authenticated owner IDs fail before repository access", async () => {
  let called = false;
  const repository: DraftRepositoryBoundary = {
    listDraftsByOwner: async () => {
      called = true;
      return { drafts: [], total: 0, summary: { draft: 0, approved: 0, scheduled: 0, total: 0 } };
    },
  };

  await assert.rejects(
    listDraftsForUser("not-an-object-id", 1, 20, undefined, repository),
    { code: "AUTHENTICATION_REQUIRED" },
  );
  assert.equal(called, false);
  assert.equal(Types.ObjectId.isValid(ownerId), true);
});
