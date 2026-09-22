import { Types } from "mongoose";
import { AppError } from "../errors/app-error.js";
import {
  defaultAnalyticsRepository,
  type AnalyticsRepository,
} from "../repositories/analytics.repository.js";
import type { AnalyticsQuery, EngagementCreateInput, EngagementUpdateInput } from "../validation/analytics.validation.js";

const dayMs = 24 * 60 * 60 * 1000;
const maxRangeDays = 93;
export type { AnalyticsRepository };

function localMidnightUtc(date: string, timezone: string): Date {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  const candidate = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
  const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(candidate - (displayed - candidate));
}

function dateText(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function resolveAnalyticsRange(query: AnalyticsQuery, now = new Date()) {
  const endDate = query.to ?? dateText(now, query.timezone);
  const startDate = query.from ?? dateText(new Date(now.getTime() - (query.preset === "7d" ? 6 : 29) * dayMs), query.timezone);
  const from = localMidnightUtc(startDate, query.timezone);
  const to = localMidnightUtc(endDate, query.timezone);
  if (to <= from || to.getTime() - from.getTime() > maxRangeDays * dayMs) {
    throw new AppError(400, "VALIDATION_ERROR", "Date range must be between 1 and 93 days.");
  }
  return { from, to, startDate, endDate };
}

function publicSnapshot(snapshot: Awaited<ReturnType<AnalyticsRepository["findSnapshot"]>>) {
  if (!snapshot) return null;
  return {
    id: snapshot._id.toString(),
    publicationId: snapshot.publicationId,
    impressions: snapshot.impressions,
    reactions: snapshot.reactions,
    comments: snapshot.comments,
    reposts: snapshot.reposts,
    observedAt: snapshot.observedAt,
    revision: snapshot.revision,
    label: "Manually entered",
  };
}

export async function getAnalyticsForUser(ownerId: string, query: AnalyticsQuery, repository: AnalyticsRepository = defaultAnalyticsRepository, now = new Date()) {
  const range = resolveAnalyticsRange(query, now);
  const [signalsCreated, generationsCompleted, approvedVariations, scheduledPublications, publicationStates, topics, reviewInsights, posts] = await Promise.all([
    repository.countSignals(ownerId, range.from, range.to),
    repository.countGenerations(ownerId, range.from, range.to),
    repository.approvedCount(ownerId),
    repository.scheduledCount(ownerId),
    repository.publicationSummary(ownerId, range.from, range.to),
    repository.topicSummary(ownerId, range.from, range.to, range.to),
    repository.reviewSummary(ownerId, range.from, range.to),
    repository.publishedPosts(ownerId, range.from, range.to, (query.page - 1) * query.limit, query.limit),
  ]);
  const snapshotRows = await repository.snapshots(ownerId, posts.map((post) => post.publicationId), range.to);
  const latestSnapshots = new Map<string, Awaited<ReturnType<AnalyticsRepository["findSnapshot"]>>>();
  for (const snapshot of [...snapshotRows].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || b._id.toString().localeCompare(a._id.toString()))) {
    if (!latestSnapshots.has(snapshot.publicationId)) latestSnapshots.set(snapshot.publicationId, snapshot);
  }
  const publicationTopics = topics.map((topic) => {
    return {
      ...topic,
      engagementRate: topic.rateEligiblePosts > 0 ? topic.rateNumerator / topic.rateDenominator : null,
      engagementRateEligiblePosts: topic.rateEligiblePosts,
      engagementRateFormula: "sum(reactions + comments + reposts) / sum(impressions) for posts with positive impressions and all three engagement counters known; unavailable otherwise",
    };
  });
  return {
    range: { from: range.from, to: range.to, timezone: query.timezone, startDate: range.startDate, endDate: range.endDate },
    definitions: {
      signalsCreated: "count of Signal records by createdAt in the selected reporting range",
      generationsCompleted: "count of persisted Generation records by createdAt; persistence means the generation completed",
      approvedVariations: "current count of variation records with status approved, independent of the period",
      confirmedPublished: "count of LinkedIn publication records with status published by publishedAt in the selected range",
      scheduledPublications: "current count of persisted automatic publications with status scheduled",
      outcomes: "rejected, blocked, missed, and uncertain publication records by updatedAt; uncertain is not counted as failure",
      engagement: "latest cumulative manually entered snapshot per confirmed post with observedAt at or before the report end",
      reviews: "latest successful non-stale review per signal/variation in the selected range; findings are technical review observations, not engagement predictions",
    },
    activity: {
      signalsCreated,
      generationsCompleted,
      approvedVariations,
      confirmedPublished: publicationStates.published ?? 0,
      scheduledPublications,
      rejected: publicationStates.rejected ?? 0,
      blocked: publicationStates.blocked ?? 0,
      missed: publicationStates.missed ?? 0,
      uncertain: publicationStates.uncertain ?? 0,
    },
    topics: publicationTopics,
    reviewInsights,
    posts: posts.map((post) => ({ ...post, engagement: publicSnapshot(latestSnapshots.get(post.publicationId) ?? null) })),
  };
}

export async function createEngagementForUser(ownerId: string, input: EngagementCreateInput, repository: AnalyticsRepository = defaultAnalyticsRepository, clock: () => Date = () => new Date()) {
  if (!Types.ObjectId.isValid(ownerId)) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  if (new Date(input.observedAt).getTime() > clock().getTime()) throw new AppError(400, "VALIDATION_ERROR", "Observation time cannot be in the future");
  const publication = await repository.findPublication(ownerId, input.publicationId);
  if (!publication) throw new AppError(404, "PUBLICATION_NOT_FOUND", "Confirmed published post not found");
  if (publication.publishedAt && new Date(input.observedAt) < publication.publishedAt) {
    throw new AppError(400, "VALIDATION_ERROR", "Observation time cannot precede publication time");
  }
  return publicSnapshot(await repository.createSnapshot(ownerId, { ...input, observedAt: new Date(input.observedAt) }));
}

export async function updateEngagementForUser(ownerId: string, snapshotId: string, input: EngagementUpdateInput, repository: AnalyticsRepository = defaultAnalyticsRepository, clock: () => Date = () => new Date()) {
  if (!Types.ObjectId.isValid(snapshotId)) throw new AppError(400, "VALIDATION_ERROR", "Invalid snapshot id");
  if (new Date(input.observedAt).getTime() > clock().getTime()) throw new AppError(400, "VALIDATION_ERROR", "Observation time cannot be in the future");
  const updated = await repository.updateSnapshot(ownerId, snapshotId, input.expectedRevision, { impressions: input.impressions, reactions: input.reactions, comments: input.comments, reposts: input.reposts, observedAt: new Date(input.observedAt) });
  if (!updated) throw new AppError(409, "ENGAGEMENT_REVISION_CONFLICT", "The engagement snapshot revision changed; reload before editing.");
  return publicSnapshot(updated);
}

export async function deleteEngagementForUser(ownerId: string, snapshotId: string, expectedRevision: number, repository: AnalyticsRepository = defaultAnalyticsRepository) {
  if (!Types.ObjectId.isValid(snapshotId)) throw new AppError(400, "VALIDATION_ERROR", "Invalid snapshot id");
  const deleted = await repository.deleteSnapshot(ownerId, snapshotId, expectedRevision);
  if (!deleted) throw new AppError(409, "ENGAGEMENT_REVISION_CONFLICT", "The engagement snapshot revision changed; reload before deleting.");
}
