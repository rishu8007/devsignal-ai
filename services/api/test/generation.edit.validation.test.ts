import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import { AppError } from "../src/errors/app-error.js";
import { authenticationMiddleware } from "../src/middleware/authentication.middleware.js";
import {
  approveGenerationVariationSchema,
  editGenerationVariationSchema,
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
