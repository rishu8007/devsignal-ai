import bcrypt from "bcrypt";
import mongoose, { Types } from "mongoose";
import { UserModel } from "../services/api/src/models/user.model.js";
import { SignalModel } from "../services/api/src/models/signal.model.js";
import { LinkedInPublicationModel } from "../services/api/src/models/linkedin-publication.model.js";
import { EngagementSnapshotModel } from "../services/api/src/models/engagement-snapshot.model.js";
import { NotificationModel } from "../services/api/src/models/notification.model.js";

const uri = process.env.MONGODB_URI ?? "";
const databaseName = "devsignal_integration";
if (!uri) throw new Error("MONGODB_URI is required.");
const parsed = new URL(uri);
if (parsed.hostname !== "127.0.0.1" || parsed.port !== "27018" || parsed.pathname !== `/${databaseName}`) {
  throw new Error("Refusing browser seed outside the dedicated localhost integration database.");
}

const ownerId = new Types.ObjectId("6ab39abec9ce8add09440001");
const otherOwnerId = new Types.ObjectId("6ab39abec9ce8add09440002");
const ownerEmail = "browser-seeded@example.test";
const otherOwnerEmail = "browser-other@example.test";
const password = "BrowserIntegrationPassword123!";
const publishedAt = new Date("2026-09-20T12:00:00.000Z");

async function main() {
  await mongoose.connect(uri);
  await Promise.all([
    UserModel.deleteMany({}),
    SignalModel.deleteMany({}),
    LinkedInPublicationModel.deleteMany({}),
    EngagementSnapshotModel.deleteMany({}),
    NotificationModel.deleteMany({}),
  ]);

  const passwordHash = await bcrypt.hash(password, 4);
  await UserModel.create([
    { _id: ownerId, name: "Seeded Browser User", email: ownerEmail, role: "user", passwordHash },
    { _id: otherOwnerId, name: "Other Browser User", email: otherOwnerEmail, role: "user", passwordHash },
  ]);

  const publicationIds = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000004",
  ];
  const signalIds = publicationIds.map(() => new Types.ObjectId());
  await SignalModel.create(signalIds.map((id, index) => ({
    _id: id,
    ownerId,
    topic: "Weighted browser analytics",
    notes: "Synthetic notes for the isolated browser analytics journey.",
    primaryAudience: "Developers & engineers",
    contentType: "Technical insight",
  })));
  await LinkedInPublicationModel.create(publicationIds.map((previewId, index) => ({
    ownerId,
    signalId: signalIds[index],
    generationId: new Types.ObjectId(),
    variationId: new Types.ObjectId(),
    draftContentHash: `browser-hash-${index}`,
    approvalFingerprint: `browser-approval-${index}`,
    textSnapshot: `Synthetic published browser post ${index + 1}`,
    providerMemberId: "browser-member",
    connectionGeneration: 1,
    visibility: "PUBLIC",
    operationKey: `browser-publication-${index}`,
    previewId,
    previewExpiresAt: new Date("2026-10-01T00:00:00.000Z"),
    status: "published",
    publishedAt,
    scheduleRevision: 0,
  })));
  await EngagementSnapshotModel.create([
    { ownerId, publicationId: publicationIds[0], impressions: 100, reactions: 5, comments: 3, reposts: 2, observedAt: new Date("2026-09-21T12:00:00.000Z") },
    { ownerId, publicationId: publicationIds[1], impressions: 1000, reactions: 10, comments: 5, reposts: 5, observedAt: new Date("2026-09-21T12:00:00.000Z") },
    { ownerId, publicationId: publicationIds[2], impressions: 50, reactions: 0, comments: null, reposts: 0, observedAt: new Date("2026-09-21T12:00:00.000Z") },
  ]);

  const notificationBase = new Date("2026-09-22T12:00:00.000Z");
  await NotificationModel.create([
    { ownerId, eventKey: "browser-notification-primary", type: "published", title: "Browser publication", message: "Your isolated browser publication is ready.", publicationId: publicationIds[0], createdAt: notificationBase, readAt: null, obsoleteAt: null },
    { ownerId, eventKey: "browser-notification-secondary", type: "failed", title: "Browser failure", message: "A synthetic browser operation failed.", publicationId: publicationIds[1], createdAt: new Date(notificationBase.getTime() - 1_000), readAt: null, obsoleteAt: null },
    ...Array.from({ length: 22 }, (_, index) => ({
      ownerId,
      eventKey: `browser-notification-${index + 3}`,
      type: "failed" as const,
      title: `Browser reminder ${index + 1}`,
      message: "A synthetic notification outside the focused display remains unread.",
      publicationId: publicationIds[2],
      createdAt: new Date(notificationBase.getTime() - (index + 2) * 1_000),
      readAt: null,
      obsoleteAt: null,
    })),
    { ownerId: otherOwnerId, eventKey: "other-owner-notification", type: "published", title: "Other owner", message: "Private notification.", publicationId: "other-publication", createdAt: notificationBase, readAt: null, obsoleteAt: null },
  ]);

  await mongoose.disconnect();
  console.log(JSON.stringify({ ownerEmail, otherOwnerEmail, password, publicationIds }));
}

void main();
