import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import {
  createEngagementForUser,
  getAnalyticsForUser,
  resolveAnalyticsRange,
  updateEngagementForUser,
  type AnalyticsRepository,
} from "../src/services/analytics.service.js";

function repository(overrides: Partial<AnalyticsRepository> = {}): AnalyticsRepository {
  const owner = new Types.ObjectId().toString();
  return {
    countSignals: async () => 2,
    countGenerations: async () => 1,
    approvedCount: async () => 3,
    scheduledCount: async () => 1,
    publicationSummary: async () => ({ published: 2, uncertain: 1 }),
    topicSummary: async () => [{ topic: "TypeScript", publications: 2, engagementPosts: 1, impressions: 100, reactions: 10, comments: 5, reposts: 2, rateNumerator: 17, rateDenominator: 100, rateEligiblePosts: 1 }],
    reviewSummary: async () => ({ population: 1, severities: { high: 1 }, categories: { clarity: 1 } }),
    publishedPosts: async () => [{ publicationId: "post-1", topic: "TypeScript", publishedAt: new Date(), text: "post" }],
    snapshots: async () => [{
      _id: new Types.ObjectId(), ownerId: new Types.ObjectId(owner), publicationId: "post-1",
      impressions: 100, reactions: 10, comments: 5, reposts: 2, observedAt: new Date("2026-09-21T00:00:00Z"), revision: 1,
      createdAt: new Date(), updatedAt: new Date(),
    }],
    findPublication: async () => ({ _id: new Types.ObjectId(), previewId: "post-1", status: "published" } as never),
    createSnapshot: async (_owner, input) => ({ _id: new Types.ObjectId(), ...input, revision: 1 } as never),
    findSnapshot: async () => null,
    updateSnapshot: async () => null,
    deleteSnapshot: async () => null,
    ...overrides,
  };
}

test("analytics resolves reporting boundaries in the requested timezone", () => {
  const range = resolveAnalyticsRange({ preset: "custom", from: "2026-09-22", to: "2026-09-23", timezone: "Asia/Kolkata", page: 1, limit: 20 });
  assert.equal(range.from.toISOString(), "2026-09-21T18:30:00.000Z");
  assert.equal(range.to.toISOString(), "2026-09-22T18:30:00.000Z");
});

test("analytics keeps owner-scoped current state and excludes uncertain from confirmed failures", async () => {
  const result = await getAnalyticsForUser(new Types.ObjectId().toString(), { preset: "30d", timezone: "UTC", page: 1, limit: 20 }, repository());
  assert.equal(result.activity.confirmedPublished, 2);
  assert.equal(result.activity.uncertain, 1);
  assert.equal(result.activity.rejected ?? 0, 0);
  assert.equal(result.topics[0]?.engagementRate, 0.17);
  assert.equal(result.topics[0]?.engagementRateEligiblePosts, 1);
});

test("latest cumulative engagement is represented without summing snapshots", async () => {
  const snapshots = [
    { _id: new Types.ObjectId(), publicationId: "post-1", observedAt: new Date("2026-09-20"), impressions: 10, reactions: 1, comments: 0, reposts: 0, revision: 1 },
    { _id: new Types.ObjectId(), publicationId: "post-1", observedAt: new Date("2026-09-21"), impressions: 100, reactions: 10, comments: 5, reposts: 2, revision: 1 },
  ];
  const result = await getAnalyticsForUser(new Types.ObjectId().toString(), { preset: "30d", timezone: "UTC", page: 1, limit: 20 }, repository({
    snapshots: async () => snapshots as never,
  }));
  assert.equal(result.posts[0]?.engagement?.impressions, 100);
});

test("engagement requires a confirmed owner-scoped publication and revision conflicts are explicit", async () => {
  const owner = new Types.ObjectId().toString();
  let requestedOwner = "";
  const scopedRepository = repository({
    findPublication: async (ownerId, publicationId) => {
      requestedOwner = ownerId;
      return publicationId === "post-1" ? ({ _id: new Types.ObjectId(), previewId: "post-1", status: "published", publishedAt: new Date("2026-09-19") } as never) : null;
    },
  });
  await createEngagementForUser(owner, {
    publicationId: "post-1", impressions: 0, reactions: null, comments: null, reposts: null, observedAt: "2026-09-20T00:00:00.000Z",
  }, scopedRepository, () => new Date("2026-09-22T00:00:00.000Z"));
  assert.equal(requestedOwner, owner);
  await assert.rejects(() => createEngagementForUser(owner, {
    publicationId: "missing", impressions: 0, reactions: null, comments: null, reposts: null, observedAt: "2026-09-20T00:00:00.000Z",
  }, repository({ findPublication: async () => null })), /Confirmed published post not found/);
  await assert.rejects(() => updateEngagementForUser(owner, new Types.ObjectId().toString(), {
    impressions: 0, reactions: null, comments: null, reposts: null, observedAt: "2026-09-20T00:00:00.000Z", expectedRevision: 1,
  }, repository()), /revision/);
});

test("zero impressions makes the engagement rate unavailable while unknown engagement is not zero", async () => {
  const result = await getAnalyticsForUser(new Types.ObjectId().toString(), { preset: "30d", timezone: "UTC", page: 1, limit: 20 }, repository({
    topicSummary: async () => [{ topic: "Unknown", publications: 1, engagementPosts: 1, impressions: 0, reactions: 0, comments: 0, reposts: 0, rateNumerator: 0, rateDenominator: 0, rateEligiblePosts: 0 }],
    snapshots: async () => [{
      _id: new Types.ObjectId(), publicationId: "post-1", observedAt: new Date(), impressions: null, reactions: null, comments: null, reposts: null, revision: 1,
    }] as never,
  }));
  assert.equal(result.topics[0]?.engagementRate, null);
  assert.equal(result.posts[0]?.engagement?.impressions, null);
});

test("rate combines eligible posts using summed engagements and impressions", async () => {
  const result = await getAnalyticsForUser(new Types.ObjectId().toString(), { preset: "30d", timezone: "UTC", page: 1, limit: 20 }, repository({
    topicSummary: async () => [{ topic: "Combined", publications: 3, engagementPosts: 3, impressions: 1100, reactions: 30, comments: 0, reposts: 0, rateNumerator: 30, rateDenominator: 1100, rateEligiblePosts: 2 }],
  }));
  assert.equal(result.topics[0]?.engagementRate, 30 / 1100);
  assert.equal(result.topics[0]?.engagementRateEligiblePosts, 2);
});

test("a partial snapshot contributes to available totals but not rate coverage", async () => {
  const result = await getAnalyticsForUser(new Types.ObjectId().toString(), { preset: "30d", timezone: "UTC", page: 1, limit: 20 }, repository({
    topicSummary: async () => [{ topic: "Partial", publications: 3, engagementPosts: 3, impressions: 1100, reactions: 30, comments: 0, reposts: 0, rateNumerator: 10, rateDenominator: 100, rateEligiblePosts: 1 }],
  }));
  assert.equal(result.topics[0]?.engagementRate, 0.1);
  assert.equal(result.topics[0]?.rateEligiblePosts, 1);
});

test("fully known zero engagement is a zero percent rate", async () => {
  const result = await getAnalyticsForUser(new Types.ObjectId().toString(), { preset: "30d", timezone: "UTC", page: 1, limit: 20 }, repository({
    topicSummary: async () => [{ topic: "Zero", publications: 1, engagementPosts: 1, impressions: 100, reactions: 0, comments: 0, reposts: 0, rateNumerator: 0, rateDenominator: 100, rateEligiblePosts: 1 }],
  }));
  assert.equal(result.topics[0]?.engagementRate, 0);
});
