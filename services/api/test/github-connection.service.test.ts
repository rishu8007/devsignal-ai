import assert from "node:assert/strict";
import test from "node:test";
import { githubAccessDenied, githubNextLink, githubRetryAt } from "../src/services/github-connection.service.js";

test("GitHub pagination follows only the provider next relation", () => {
  assert.equal(
    githubNextLink('<https://api.github.com/repos/acme/app/commits?page=2>; rel="next", <https://api.github.com/repos/acme/app/commits?page=4>; rel="last"'),
    "https://api.github.com/repos/acme/app/commits?page=2",
  );
  assert.equal(githubNextLink('<https://api.github.com/repos/acme/app/commits?page=1>; rel="prev"'), null);
});

test("GitHub rate-limit deadlines honor retry-after and reset headers", () => {
  const now = Date.parse("2026-09-24T00:00:00.000Z");
  const retry = githubRetryAt(429, new Headers({ "retry-after": "45" }), now);
  assert.equal(retry?.getTime(), now + 45_000);
  const reset = githubRetryAt(403, new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String((now + 90_000) / 1000) }), now);
  assert.equal(reset?.getTime(), now + 90_000);
  assert.equal(githubRetryAt(403, new Headers({ "x-ratelimit-remaining": "12" }), now), null);
  assert.equal(githubAccessDenied(403, new Headers({ "x-ratelimit-remaining": "12" })), true);
  assert.equal(githubAccessDenied(403, new Headers({ "x-ratelimit-remaining": "0" })), false);
});
