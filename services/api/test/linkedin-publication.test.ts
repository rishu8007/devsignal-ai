import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { env } from "../src/config/env.js";
import { encryptLinkedInSecret } from "../src/services/linkedin-crypto.js";
import {
  cancelScheduledLinkedInPublication,
  confirmLinkedInPublication,
  createLinkedInPublicationPreview,
  dispatchClaimedLinkedInPublication,
  rescheduleLinkedInPublication,
  scheduleLinkedInPublication,
  type LinkedInPublicationRepository,
} from "../src/services/linkedin-publication.service.js";
import type { LinkedInPublishingClient } from "../src/clients/linkedin-publishing.client.js";
import { HttpLinkedInPublishingClient } from "../src/clients/linkedin-publishing.client.js";

const ownerId = new Types.ObjectId().toString();
const signalId = new Types.ObjectId().toString();
const generationId = new Types.ObjectId();
const variationId = new Types.ObjectId();
const key = Buffer.alloc(32, 9).toString("base64");
const text = "An approved LinkedIn draft with enough content to exercise the exact immutable publication snapshot boundary safely.";

function makeGeneration(content = text, status: "approved" | "draft" = "approved") {
  return {
    _id: generationId,
    variations: [{ _id: variationId, content, status, scheduledFor: null, citations: [], angle: "technical_depth" }],
  };
}

function makeConnection(generation = 1) {
  return {
    providerMemberId: "member-123",
    providerDisplayName: "Test Member",
    connectionGeneration: generation,
    status: "connected",
    accessTokenEncrypted: encryptLinkedInSecret("secret-token", key),
    refreshTokenEncrypted: null,
    expiresAt: new Date(Date.now() + 60_000),
    grantedScopes: ["openid", "profile", "w_member_social"],
    capabilities: { identity: true, posting: true },
  };
}

function repository(overrides: Partial<LinkedInPublicationRepository> = {}) {
  const stored = new Map<string, any>();
  const generation = makeGeneration();
  const connection = makeConnection();
  const base: LinkedInPublicationRepository = {
    findConnection: async () => connection as never,
    findPublication: async (_owner, previewId) => stored.get(previewId) ?? null,
    findByOperationKey: async (_owner, operationKey) => [...stored.values()].find((item) => item.operationKey === operationKey) ?? null,
    createPublication: async (input) => {
      const record = { ...input, _id: new Types.ObjectId(), createdAt: new Date(), dispatchedAt: null, publishedAt: null, providerPostId: null, errorCode: null, errorMessage: null };
        record.scheduleRevision = 0;
        stored.set(record.previewId, record);
      return record as never;
    },
    claimPublication: async (id, leaseId, now) => {
      const record = [...stored.values()].find((item) => item._id.toString() === id);
      if (!record || record.status !== "pending" || record.previewExpiresAt <= now) return null;
      record.leaseId = leaseId;
      record.leaseExpiresAt = new Date(now.getTime() + 120_000);
      return record;
    },
    authorizeDispatch: async (id, leaseId, expectedRevision, now) => {
      const record = [...stored.values()].find((item) => item._id.toString() === id);
      if (!record || !["pending", "scheduled"].includes(record.status) || record.scheduleRevision !== expectedRevision || record.leaseId !== leaseId || record.leaseExpiresAt <= now || record.cancelledAt) return null;
      record.status = "dispatching";
      record.dispatchAuthorizedAt = now;
      record.dispatchedAt = now;
      return record;
    },
    updatePublication: async (id, update) => {
      const record = [...stored.values()].find((item) => item._id.toString() === id);
      if (!record) return null;
      Object.assign(record, update);
      return record;
    },
    schedulePublication: async (id, expectedRevision, input) => {
      const record = [...stored.values()].find((item) => item._id.toString() === id);
      if (!record || record.status !== "pending" || record.scheduleRevision !== expectedRevision) return null;
      Object.assign(record, input, { status: "scheduled" });
      record.scheduleRevision += 1;
      return record;
    },
    cancelPublication: async (id, expectedRevision, now) => {
      const record = [...stored.values()].find((item) => item._id.toString() === id);
      if (!record || record.status !== "scheduled" || record.scheduleRevision !== expectedRevision) return null;
      Object.assign(record, { status: "cancelled", cancelledAt: now });
      record.scheduleRevision += 1;
      return record;
    },
    reschedulePublication: async (id, expectedRevision, scheduledAt, timezone) => {
      const record = [...stored.values()].find((item) => item._id.toString() === id);
      if (!record || record.status !== "scheduled" || record.scheduleRevision !== expectedRevision) return null;
      Object.assign(record, { scheduledAt, scheduledTimezone: timezone });
      record.scheduleRevision += 1;
      return record;
    },
    claimDuePublication: async () => null,
    blockUnpublishedPublication: async (id, leaseId, update) => {
      const record = [...stored.values()].find((item) => item._id.toString() === id);
      if (!record || record.status !== "scheduled" || record.leaseId !== leaseId || record.dispatchAuthorizedAt) return null;
      Object.assign(record, update, { leaseId: null, leaseExpiresAt: null });
      return record;
    },
    recoverExpiredDispatch: async () => null,
    fencePublication: async (id, leaseId, update) => {
      const record = [...stored.values()].find((item) => item._id.toString() === id);
      if (!record || record.status !== "dispatching" || record.leaseId !== leaseId) return null;
      Object.assign(record, update);
      return record;
    },
    listPublications: async () => [...stored.values()],
    findGeneration: async () => generation as never,
    listWorkflows: async () => [],
    ...overrides,
  };
  return { base, stored, generation, connection };
}

function enablePublishing() {
  const mutable = env as typeof env & Record<string, unknown>;
  mutable.LINKEDIN_ENABLED = true;
  mutable.LINKEDIN_PUBLISHING_ENABLED = true;
  mutable.LINKEDIN_TOKEN_ENCRYPTION_KEY = key;
}

test("preview snapshots exact approved content and duplicate previews reuse one operation", async () => {
  enablePublishing();
  const { base } = repository();
  const first = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date(), base);
  const second = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date(), base);
  assert.equal(first.text, text);
  assert.equal(first.account.memberId, "member-123");
  assert.equal(first.id, second.id);
});

test("changed draft and expired preview never dispatch", async () => {
  enablePublishing();
  const fake = { publishTextPost: async () => { throw new Error("must not dispatch"); } } satisfies LinkedInPublishingClient;
  const { base, generation } = repository();
  const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date(), base);
  generation.variations[0].content = `${text} changed`;
  await assert.rejects(
    confirmLinkedInPublication(ownerId, preview.id, fake, new Date(), base),
    (error: unknown) => error instanceof Error && error.message.includes("changed"),
  );

  const expired = repository();
  const old = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date(Date.now() - 700_000), expired.base);
  const result = await confirmLinkedInPublication(ownerId, old.id, fake, new Date(), expired.base);
  assert.equal(result.status, "rejected");
});

test("cross-owner and unapproved drafts cannot create a preview", async () => {
  enablePublishing();
  const { base } = repository({
    findGeneration: async (requestedOwner) => requestedOwner === ownerId ? makeGeneration() as never : null,
  });
  await assert.rejects(
    createLinkedInPublicationPreview(new Types.ObjectId().toString(), signalId, variationId.toString(), new Date(), base),
    /Draft not found/,
  );
  const unapproved = repository({
    findGeneration: async () => makeGeneration(text, "draft") as never,
  });
  await assert.rejects(
    createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date(), unapproved.base),
    /approved draft/i,
  );
});

test("disconnect before confirmation blocks provider dispatch", async () => {
  enablePublishing();
  const { base, connection } = repository();
  const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date(), base);
  connection.status = "reconnect_required";
  let calls = 0;
  const provider: LinkedInPublishingClient = {
    publishTextPost: async () => {
      calls += 1;
      return { kind: "published", providerPostId: "must-not-send" };
    },
  };
  await assert.rejects(confirmLinkedInPublication(ownerId, preview.id, provider, new Date(), base), /posting permission/i);
  assert.equal(calls, 0);
});

test("published and uncertain operations are idempotent and never automatically repost", async () => {
  enablePublishing();
  const { base } = repository();
  let calls = 0;
  const provider: LinkedInPublishingClient = {
    publishTextPost: async () => {
      calls += 1;
      return { kind: "published", providerPostId: "urn:li:share:1" };
    },
  };
  const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date(), base);
  assert.equal((await confirmLinkedInPublication(ownerId, preview.id, provider, new Date(), base)).status, "published");
  assert.equal((await confirmLinkedInPublication(ownerId, preview.id, provider, new Date(), base)).status, "published");
  assert.equal(calls, 1);

  const uncertainRepo = repository();
  const uncertainProvider: LinkedInPublishingClient = {
    publishTextPost: async () => {
      calls += 1;
      return { kind: "uncertain", errorCode: "TIMEOUT", errorMessage: "Check LinkedIn before taking further action." };
    },
  };
  const uncertainPreview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date(), uncertainRepo.base);
  assert.equal((await confirmLinkedInPublication(ownerId, uncertainPreview.id, uncertainProvider, new Date(), uncertainRepo.base)).status, "uncertain");
  assert.equal((await confirmLinkedInPublication(ownerId, uncertainPreview.id, uncertainProvider, new Date(), uncertainRepo.base)).status, "uncertain");
  assert.equal(calls, 2);
});

test("provider success followed by persistence failure remains non-retryable", async () => {
  enablePublishing();
  const { base } = repository({
    updatePublication: async () => null,
  });
  let calls = 0;
  const provider: LinkedInPublishingClient = {
    publishTextPost: async () => {
      calls += 1;
      return { kind: "published", providerPostId: "urn:li:share:2" };
    },
  };
  const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date(), base);
  await assert.rejects(confirmLinkedInPublication(ownerId, preview.id, provider, new Date(), base), /could not be saved/i);
  assert.equal(calls, 1);
});

test("provider client sends the exact member text contract and never retries", async () => {
  let calls = 0;
  let captured: { url: string; init: RequestInit } | null = null;
  const client = new HttpLinkedInPublishingClient(async (url, init) => {
    calls += 1;
    captured = { url: String(url), init };
    return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:9" } });
  });
  const result = await client.publishTextPost("token", "member-123", text);
  assert.deepEqual(result, { kind: "published", providerPostId: "urn:li:share:9" });
  assert.equal(calls, 1);
  assert.equal(captured?.url, "https://api.linkedin.com/rest/posts");
  assert.equal(captured?.init.method, "POST");
  const headers = new Headers(captured?.init.headers);
  assert.equal(headers.get("X-Restli-Protocol-Version"), "2.0.0");
  assert.equal(headers.get("LinkedIn-Version"), env.LINKEDIN_API_VERSION);
  const body = JSON.parse(String(captured?.init.body)) as { author: string; commentary: string; visibility: string };
  assert.equal(body.author, "urn:li:person:member-123");
  assert.equal(body.commentary, text);
  assert.equal(body.visibility, "PUBLIC");
});

test("provider timeout is uncertain and performs no retry", async () => {
  let calls = 0;
  const client = new HttpLinkedInPublishingClient(async () => {
    calls += 1;
    throw new Error("timeout");
  });
  const result = await client.publishTextPost("token", "member-123", text);
  assert.equal(result.kind, "uncertain");
  assert.equal(calls, 1);
});

  test("scheduling validates timezone and DST, then supports reschedule and cancel", async () => {
    enablePublishing();
    const mutable = env as typeof env & Record<string, unknown>;
    mutable.LINKEDIN_SCHEDULER_ENABLED = true;
    const fixedNow = new Date("2026-01-01T12:00:00.000Z");
    const repo = repository();
    const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), fixedNow, repo.base);
    await assert.rejects(
      scheduleLinkedInPublication(ownerId, preview.id, "2026-03-08T02:30", "America/New_York", "earlier", fixedNow, repo.base),
      /does not exist/i,
    );
    await assert.rejects(
      scheduleLinkedInPublication(ownerId, preview.id, "2026-11-01T01:30", "America/New_York", undefined, fixedNow, repo.base),
      /repeated daylight-saving/i,
    );
    const scheduled = await scheduleLinkedInPublication(ownerId, preview.id, "2026-03-20T09:30", "America/New_York", "earlier", fixedNow, repo.base);
    assert.equal(scheduled.status, "scheduled");
    assert.equal(scheduled.scheduledTimezone, "America/New_York");
    const rescheduled = await rescheduleLinkedInPublication(ownerId, preview.id, scheduled.scheduleRevision, "2026-03-21T09:30", "America/New_York", "earlier", fixedNow, repo.base);
    assert.equal(rescheduled.scheduleRevision, 2);
    const cancelled = await cancelScheduledLinkedInPublication(ownerId, preview.id, rescheduled.scheduleRevision, fixedNow, repo.base);
    assert.equal(cancelled.status, "cancelled");
  });

  test("scheduled authorization shares the duplicate guard with immediate publishing", async () => {
    enablePublishing();
    const mutable = env as typeof env & Record<string, unknown>;
    mutable.LINKEDIN_SCHEDULER_ENABLED = true;
    const fixedNow = new Date("2026-01-01T12:00:00.000Z");
    const repo = repository();
    const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), fixedNow, repo.base);
    const scheduled = await scheduleLinkedInPublication(ownerId, preview.id, "2026-03-20T09:30", "America/New_York", "earlier", fixedNow, repo.base);
    let calls = 0;
    const provider: LinkedInPublishingClient = { publishTextPost: async () => { calls += 1; return { kind: "published", providerPostId: "should-not-send" }; } };
    const immediate = await confirmLinkedInPublication(ownerId, scheduled.id, provider, fixedNow, repo.base);
    assert.equal(immediate.status, "scheduled");
    assert.equal(calls, 0);
  });

  test("cancellation wins against a preliminary worker lease", async () => {
    enablePublishing();
    const mutable = env as typeof env & Record<string, unknown>;
    mutable.LINKEDIN_SCHEDULER_ENABLED = true;
    const fixedNow = new Date("2026-01-01T12:00:00.000Z");
    const repo = repository();
    const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), fixedNow, repo.base);
    const scheduled = await scheduleLinkedInPublication(ownerId, preview.id, "2026-03-20T09:30", "America/New_York", "earlier", fixedNow, repo.base);
    const stored = repo.stored.get(scheduled.id);
    stored.leaseId = "old-worker";
    stored.leaseExpiresAt = new Date("2026-03-20T14:01:00.000Z");
    const cancelled = await cancelScheduledLinkedInPublication(ownerId, preview.id, scheduled.scheduleRevision, fixedNow, repo.base);
    assert.equal(cancelled.status, "cancelled");
    let calls = 0;
    const result = await dispatchClaimedLinkedInPublication(stored, "old-worker", { publishTextPost: async () => { calls += 1; return { kind: "published", providerPostId: "must-not-send" }; } }, new Date("2026-03-20T14:00:00.000Z"), repo.base);
    assert.equal(result, null);
    assert.equal(calls, 0);
  });

  test("reapproval changes the approval fingerprint and blocks old scheduling consent", async () => {
    enablePublishing();
    const fixedNow = new Date("2026-01-01T12:00:00.000Z");
    const repo = repository();
    repo.generation.updatedAt = new Date("2026-01-01T11:00:00.000Z");
    const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), fixedNow, repo.base);
    repo.generation.updatedAt = new Date("2026-01-01T11:00:00.000Z");
    const scheduled = await scheduleLinkedInPublication(ownerId, preview.id, "2026-03-20T09:30", "America/New_York", "earlier", fixedNow, repo.base);
    assert.equal(scheduled.status, "scheduled");
    repo.generation.updatedAt = new Date("2026-01-01T11:45:00.000Z");
    const stored = repo.stored.get(scheduled.id);
    stored.leaseId = "approval-change";
    stored.leaseExpiresAt = new Date("2026-03-20T14:01:00.000Z");
    let calls = 0;
    const result = await dispatchClaimedLinkedInPublication(stored, "approval-change", { publishTextPost: async () => { calls += 1; return { kind: "published", providerPostId: "must-not-send" }; } }, new Date("2026-03-20T14:00:00.000Z"), repo.base);
    assert.equal(result?.status, "blocked");
    assert.equal(calls, 0);
  });

  test("disabled scheduling prevents provider dispatch", async () => {
    enablePublishing();
    const mutable = env as typeof env & Record<string, unknown>;
    mutable.LINKEDIN_SCHEDULER_ENABLED = false;
    const repo = repository();
    const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date("2026-01-01T12:00:00.000Z"), repo.base);
    await assert.rejects(scheduleLinkedInPublication(ownerId, preview.id, "2026-03-20T09:30", "America/New_York", "earlier", new Date("2026-01-01T12:00:00.000Z"), repo.base), /not enabled/i);
  });

  test("scheduled dispatch fences the lease and publishes the immutable snapshot", async () => {
    enablePublishing();
    const mutable = env as typeof env & Record<string, unknown>;
    mutable.LINKEDIN_SCHEDULER_ENABLED = true;
    const fixedNow = new Date("2026-03-20T14:00:00.000Z");
    const repo = repository();
    const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date("2026-01-01T12:00:00.000Z"), repo.base);
    const scheduled = await scheduleLinkedInPublication(ownerId, preview.id, "2026-03-20T09:30", "America/New_York", "earlier", new Date("2026-01-01T12:00:00.000Z"), repo.base);
    const stored = repo.stored.get(scheduled.id);
    stored.status = "scheduled";
    stored.leaseId = "lease";
    stored.leaseExpiresAt = new Date(fixedNow.getTime() + 60_000);
    stored.scheduledAt = new Date("2026-03-20T13:30:00.000Z");
    let sent = "";
    const result = await dispatchClaimedLinkedInPublication(stored, "lease", {
      publishTextPost: async (_token, _member, content) => {
        sent = content;
        return { kind: "published", providerPostId: "urn:li:share:scheduled" };
      },
    }, fixedNow, repo.base);
    assert.equal(result?.status, "published");
    assert.equal(sent, text);
  });

  test("overdue jobs become missed and stale lease results cannot advance state", async () => {
    enablePublishing();
    const mutable = env as typeof env & Record<string, unknown>;
    mutable.LINKEDIN_SCHEDULER_ENABLED = true;
    const repo = repository();
    const preview = await createLinkedInPublicationPreview(ownerId, signalId, variationId.toString(), new Date("2026-01-01T12:00:00.000Z"), repo.base);
    const scheduled = await scheduleLinkedInPublication(ownerId, preview.id, "2026-03-20T09:30", "America/New_York", "earlier", new Date("2026-01-01T12:00:00.000Z"), repo.base);
    const stored = repo.stored.get(scheduled.id);
    stored.status = "scheduled";
    stored.leaseId = "expired-lease";
    stored.leaseExpiresAt = new Date("2026-03-20T11:00:00.000Z");
    stored.scheduledAt = new Date("2026-03-20T10:00:00.000Z");
    const missed = await dispatchClaimedLinkedInPublication(stored, "expired-lease", {
      publishTextPost: async () => ({ kind: "published", providerPostId: "must-not-send" }),
    }, new Date("2026-03-20T12:00:01.000Z"), repo.base);
    assert.equal(missed?.status, "missed");

    stored.status = "scheduled";
    stored.leaseId = "old";
    stored.leaseExpiresAt = new Date("2026-03-20T11:00:00.000Z");
    const originalFence = repo.base.fencePublication;
    repo.base.fencePublication = async () => null;
    const rejected = await dispatchClaimedLinkedInPublication(stored, "old", {
      publishTextPost: async () => ({ kind: "published", providerPostId: "must-not-send" }),
    }, new Date("2026-03-20T10:00:00.000Z"), repo.base);
    assert.equal(rejected, null);
    repo.base.fencePublication = originalFence;
  });
