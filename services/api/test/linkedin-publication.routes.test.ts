import assert from "node:assert/strict";
import test from "node:test";
import { linkedinPublicationRouter } from "../src/routes/linkedin-publication.routes.js";

test("LinkedIn publication history is not behind the publishing rate limiter", () => {
  const stack = (linkedinPublicationRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ name?: string }>;
      };
    }>;
  }).stack;
  const history = stack.find((layer) => layer.route?.path === "/")?.route;
  const preview = stack.find((layer) => layer.route?.path === "/preview")?.route;

  assert.ok(history);
  assert.ok(preview);
  assert.equal(history.stack.length, 1);
  assert.equal(preview.stack.length, 3);
});
