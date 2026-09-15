import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import { AppError } from "../src/errors/app-error.js";
import { authenticationMiddleware } from "../src/middleware/authentication.middleware.js";
import {
  approveGenerationVariationSchema,
  editGenerationVariationSchema,
  generationRequestSchema,
  generationVariationParamsSchema,
  scheduleGenerationVariationSchema,
} from "../src/validation/generation.validation.js";

test("generation editing middleware rejects unauthenticated requests", () => {
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
  assert.equal(receivedError.statusCode, 401);
});

test("generation variation params require two valid ObjectId strings", () => {
  assert.equal(
    generationVariationParamsSchema.safeParse({
      signalId: "507f1f77bcf86cd799439013",
      variationId: "507f1f77bcf86cd799439015",
    }).success,
    true,
  );
  assert.equal(
    generationVariationParamsSchema.safeParse({
      signalId: "not-an-id",
      variationId: "507f1f77bcf86cd799439015",
    }).success,
    false,
  );
  assert.equal(
    generationVariationParamsSchema.safeParse({
      signalId: "507f1f77bcf86cd799439013",
      variationId: "507f1f77bcf86cd799439015",
      ownerId: "unexpected",
    }).success,
    false,
  );
});

test("editing and approval bodies enforce their strict contracts", () => {
  assert.equal(
    editGenerationVariationSchema.safeParse({ content: "x".repeat(100) }).success,
    true,
  );
  assert.equal(
    editGenerationVariationSchema.safeParse({
      content: "x".repeat(100),
      status: "approved",
    }).success,
    false,
  );
  assert.equal(
    editGenerationVariationSchema.safeParse({ content: "too short" }).success,
    false,
  );
  assert.equal(
    approveGenerationVariationSchema.safeParse({}).success,
    true,
  );
  assert.equal(
    approveGenerationVariationSchema.safeParse({ content: "unexpected" }).success,
    false,
  );
});

test("schedule route authentication and strict request validation", () => {
  let receivedError: unknown;
  authenticationMiddleware(
    { cookies: {} } as Request,
    {} as never,
    (error?: unknown) => {
      receivedError = error;
    },
  );
  assert.equal((receivedError as AppError).code, "AUTHENTICATION_REQUIRED");
  assert.equal(
    scheduleGenerationVariationSchema.safeParse({
      scheduledFor: "2030-01-01T00:00:00Z",
    }).success,
    true,
  );
  assert.equal(
    scheduleGenerationVariationSchema.safeParse({
      scheduledFor: "2030-01-01T00:00:00",
    }).success,
    false,
  );
  assert.equal(
    scheduleGenerationVariationSchema.safeParse({
      scheduledFor: "2030-01-01T00:00:00Z",
      ownerId: "unexpected",
    }).success,
    false,
  );
});

test("generation request body defaults useKnowledge to false for both a missing and empty body", () => {
  const missingBody = generationRequestSchema.safeParse(undefined);
  assert.equal(missingBody.success, true);
  assert.equal(missingBody.success && missingBody.data.useKnowledge, false);

  const emptyBody = generationRequestSchema.safeParse({});
  assert.equal(emptyBody.success, true);
  assert.equal(emptyBody.success && emptyBody.data.useKnowledge, false);
});

test("generation request body accepts an explicit opt-in flag", () => {
  const parsed = generationRequestSchema.safeParse({ useKnowledge: true });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.useKnowledge, true);
});

test("generation request body strictly rejects client-supplied context, citations, or ownerId", () => {
  assert.equal(
    generationRequestSchema.safeParse({
      useKnowledge: true,
      context: [{ chunkId: "chunk-1", text: "injected" }],
    }).success,
    false,
  );
  assert.equal(
    generationRequestSchema.safeParse({ useKnowledge: true, citations: ["chunk-1"] }).success,
    false,
  );
  assert.equal(
    generationRequestSchema.safeParse({
      useKnowledge: true,
      ownerId: "507f1f77bcf86cd799439011",
    }).success,
    false,
  );
  assert.equal(
    generationRequestSchema.safeParse({ useKnowledge: "true" }).success,
    false,
  );
});
