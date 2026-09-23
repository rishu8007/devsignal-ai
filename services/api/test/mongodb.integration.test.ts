import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose, { Types } from "mongoose";
import { reserveUsage, transitionUsage } from "../src/repositories/usage.repository.js";
import { QuotaModel, UsageModel } from "../src/models/usage.model.js";
import { SignalModel } from "../src/models/signal.model.js";
import { LinkedInPublicationModel } from "../src/models/linkedin-publication.model.js";
import { EngagementSnapshotModel } from "../src/models/engagement-snapshot.model.js";
import { DraftReviewModel } from "../src/models/draft-review.model.js";
import { defaultAnalyticsRepository, ensureAnalyticsIndexes } from "../src/repositories/analytics.repository.js";
import { ensureLinkedInIndexes, claimLinkedInPublication, authorizeLinkedInPublicationDispatch, cancelLinkedInPublication } from "../src/repositories/linkedin.repository.js";

const uri = process.env.MONGODB_INTEGRATION_URI ?? "";
const dbName = "devsignal_integration";
const owner = new Types.ObjectId();
const otherOwner = new Types.ObjectId();
const now = new Date("2026-09-23T00:00:00.000Z");

before(async () => {
  const parsed = uri ? new URL(uri) : null;
  if (!parsed || parsed.hostname !== "127.0.0.1" || parsed.port !== "27018" || parsed.pathname !== `/${dbName}`) {
    throw new Error("Refusing integration tests: MONGODB_INTEGRATION_URI is not the dedicated localhost database");
  }
  await mongoose.connect(uri);
  await Promise.all([UsageModel.deleteMany({}), QuotaModel.deleteMany({}), SignalModel.deleteMany({}), LinkedInPublicationModel.deleteMany({}), EngagementSnapshotModel.deleteMany({}), DraftReviewModel.deleteMany({})]);
  await ensureAnalyticsIndexes();
  await ensureLinkedInIndexes();
});

test.beforeEach(async () => {
  await Promise.all([UsageModel.deleteMany({}), QuotaModel.deleteMany({}), SignalModel.deleteMany({}), LinkedInPublicationModel.deleteMany({}), EngagementSnapshotModel.deleteMany({}), DraftReviewModel.deleteMany({})]);
});

after(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("real MongoDB admission enforces owner and application limits under concurrency", async () => {
  const sameOwner = await Promise.all(
    [1, 2].map((n) => reserveUsage(owner.toString(), now, `same-owner-${n}`, "generation", 1, 100, now)),
  );
  assert.equal(sameOwner.filter(Boolean).length, 1);

  await Promise.all([UsageModel.deleteMany({}), QuotaModel.deleteMany({})]);
  const competing = await Promise.all(
    [owner, otherOwner].map((id) => reserveUsage(id.toString(), now, `app-${id}`, "generation", 100, 1, now)),
  );
  assert.equal(competing.filter(Boolean).length, 1);
});

test("real MongoDB uniqueness and lifecycle transitions prevent replay", async () => {
  const first = await reserveUsage(owner.toString(), now, "duplicate-operation", "research", 100, 100, now);
  const duplicate = await reserveUsage(owner.toString(), new Date(now.getTime() + 86_400_000), "duplicate-operation", "research", 100, 100, now);
  assert.ok(first);
  assert.equal(duplicate?.duplicate, true);
  const dispatched = await transitionUsage(first!.reservation._id.toString(), "reserved", "dispatched", undefined, now);
  assert.ok(dispatched);
  const uncertain = await transitionUsage(first!.reservation._id.toString(), "dispatched", "uncertain", undefined, now);
  assert.ok(uncertain);
  assert.equal(await transitionUsage(first!.reservation._id.toString(), "uncertain", "dispatched", undefined, now), null);

  const released = await reserveUsage(otherOwner.toString(), now, "released-operation", "generation", 100, 100, now);
  assert.ok(released);
  assert.ok(await transitionUsage(released!.reservation._id.toString(), "reserved", "released", undefined, now));
  assert.equal(await transitionUsage(released!.reservation._id.toString(), "reserved", "released", undefined, now), null);
});

test("real MongoDB publication authorization is single-winner and cancellation fences claims", async () => {
  const publicationId = new Types.ObjectId();
  const input = {
    _id: publicationId, ownerId: owner, signalId: new Types.ObjectId(), generationId: new Types.ObjectId(),
    variationId: new Types.ObjectId(), draftContentHash: "hash", approvalFingerprint: "approval",
    textSnapshot: "synthetic post", providerMemberId: "member", visibility: "PUBLIC", operationKey: "integration-publication",
    previewId: "integration-preview", previewExpiresAt: new Date(now.getTime() + 3600000), status: "pending",
    scheduleRevision: 0, leaseId: "lease", leaseExpiresAt: new Date(now.getTime() + 60000), connectionGeneration: 1,
  };
  await LinkedInPublicationModel.create(input);
  const claims = await Promise.all([1, 2].map((n) => authorizeLinkedInPublicationDispatch(publicationId.toString(), "lease", 0, new Date(now.getTime() + n))));
  assert.equal(claims.filter(Boolean).length, 1);

  const cancelledId = new Types.ObjectId();
  await LinkedInPublicationModel.create({ ...input, _id: cancelledId, operationKey: "integration-cancel", previewId: "integration-cancel-preview", leaseId: null, leaseExpiresAt: null });
  assert.ok(await cancelLinkedInPublication(cancelledId.toString(), 0, now));
  assert.equal(await authorizeLinkedInPublicationDispatch(cancelledId.toString(), "lease", 0, now), null);
});

test("real MongoDB analytics aggregation isolates owners and uses latest cumulative snapshots", async () => {
  const signalId = new Types.ObjectId();
  const publicationId = new Types.ObjectId();
  const publishedAt = new Date("2026-09-01T00:00:00.000Z");
  await SignalModel.create({ _id: signalId, ownerId: owner, topic: "Mongo analytics", notes: "Synthetic integration notes with enough length.", primaryAudience: "Developers & engineers", contentType: "Technical insight" });
  await LinkedInPublicationModel.create({
    _id: publicationId, ownerId: owner, signalId, generationId: new Types.ObjectId(), variationId: new Types.ObjectId(),
    draftContentHash: "analytics-hash", approvalFingerprint: "analytics-approval", textSnapshot: "post", providerMemberId: "member",
    visibility: "PUBLIC", operationKey: "analytics-publication", previewId: "analytics-preview", previewExpiresAt: new Date("2026-10-01"), connectionGeneration: 1,
    status: "published", publishedAt, scheduleRevision: 0,
  });
  await EngagementSnapshotModel.create([
    { ownerId: owner, publicationId: "analytics-preview", impressions: 100, reactions: 1, comments: 2, reposts: 3, observedAt: new Date("2026-09-02") },
    { ownerId: owner, publicationId: "analytics-preview", impressions: 1000, reactions: 10, comments: 10, reposts: 0, observedAt: new Date("2026-09-03") },
    { ownerId: otherOwner, publicationId: "analytics-preview", impressions: 9999, reactions: 999, comments: 999, reposts: 999, observedAt: new Date("2026-09-03") },
  ]);
  const rows = await defaultAnalyticsRepository.topicSummary(owner.toString(), new Date("2026-09-01"), new Date("2026-10-01"), new Date("2026-10-01"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.rateNumerator, 20);
  assert.equal(rows[0]?.rateDenominator, 1000);
  assert.equal(rows[0]?.rateEligiblePosts, 1);
});

test("real MongoDB review aggregation counts the latest review once", async () => {
  const signalId = new Types.ObjectId();
  const generationId = new Types.ObjectId();
  const variationId = new Types.ObjectId();
  const base = {
    ownerId: owner, requestId: "review-1", inputFingerprint: "fingerprint", signalId, generationId, variationId,
    researchBriefId: new Types.ObjectId(), draftContentHash: "hash", draftContent: "draft",
    briefSnapshot: [], summary: "summary", status: "succeeded", stale: false, model: "test",
  };
  const finding = { category: "clarity", severity: "low", passage: "passage", explanation: "explanation", evidenceIds: [], suggestion: "suggestion" };
  await DraftReviewModel.create([
    { ...base, findings: [finding], createdAt: new Date("2026-09-02"), updatedAt: new Date("2026-09-02") },
    { ...base, requestId: "review-2", findings: [finding, { ...finding, severity: "high" }], createdAt: new Date("2026-09-03"), updatedAt: new Date("2026-09-03") },
  ]);
  const summary = await defaultAnalyticsRepository.reviewSummary(owner.toString(), new Date("2026-09-01"), new Date("2026-09-10"));
  assert.equal(summary.population, 1);
  assert.deepEqual(summary.severities, { low: 1, high: 1 });
});
