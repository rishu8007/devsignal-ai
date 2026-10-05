import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import type { RequestHandler } from "express";
import { createGenerationRateLimitMiddleware } from "../src/middleware/generation-rate-limit.middleware.js";

test("generation rate limiter runs when enabled", () => {
  let limiterCalled = false;
  const limiter: RequestHandler = (_request, _response, next) => {
    limiterCalled = true;
    next();
  };
  let nextCalled = false;
  createGenerationRateLimitMiddleware(true, limiter)({} as Request, {} as Response, () => {
    nextCalled = true;
  });
  assert.equal(limiterCalled, true);
  assert.equal(nextCalled, true);
});

test("generation rate limiter is bypassed when disabled", () => {
  let limiterCalled = false;
  const limiter: RequestHandler = () => {
    limiterCalled = true;
  };
  let nextCalled = false;
  createGenerationRateLimitMiddleware(false, limiter)({} as Request, {} as Response, () => {
    nextCalled = true;
  });
  assert.equal(limiterCalled, false);
  assert.equal(nextCalled, true);
});