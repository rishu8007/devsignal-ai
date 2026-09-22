import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import {
  getUnreadNotificationCount,
  readDisplayedNotifications,
  readNotification,
  reconcileLinkedInNotifications,
  type NotificationRepository,
} from "../src/services/notification.service.js";

function setup() {
  const owner = new Types.ObjectId().toString();
  const otherOwner = new Types.ObjectId().toString();
  const created: any[] = [];
  const publications: any[] = [];
  const repository: NotificationRepository = {
    create: async (input) => {
      if (created.some((value) => value.eventKey === input.eventKey && value.ownerId === input.ownerId)) {
        const error = Object.assign(new Error("duplicate"), { code: 11000 });
        throw error;
      }
      const value = { _id: new Types.ObjectId(), ...input, readAt: null, obsoleteAt: null };
      created.push(value);
      return value as never;
    },
    list: async (requestedOwner) => created.filter((value) => value.ownerId === requestedOwner && !value.obsoleteAt) as never,
    countUnread: async (requestedOwner) => created.filter((value) => value.ownerId === requestedOwner && !value.readAt && !value.obsoleteAt).length,
    markRead: async (requestedOwner, id, at) => {
      const value = created.find((item) => item.ownerId === requestedOwner && item._id.toString() === id && !item.readAt && !item.obsoleteAt);
      if (value) value.readAt = at;
      return value ?? null;
    },
    markReadMany: async (requestedOwner, ids, at) => {
      for (const value of created) if (value.ownerId === requestedOwner && ids.includes(value._id.toString()) && !value.readAt && !value.obsoleteAt) value.readAt = at;
      return { acknowledged: true, modifiedCount: 1 } as never;
    },
    obsoleteReminders: async (publicationId, revision, at) => {
      for (const value of created) {
        if (value.publicationId === publicationId && value.type === "scheduled_reminder" &&
          !value.obsoleteAt && (revision === null || value.scheduleRevision !== revision)) value.obsoleteAt = at;
      }
      return { acknowledged: true, modifiedCount: 1 } as never;
    },
    listPublications: async (afterId, limit) => {
      const start = afterId ? Math.max(0, publications.findIndex((value) => value._id.toString() === afterId) + 1) : 0;
      return publications.slice(start, start + limit) as never;
    },
  };
  return { owner, otherOwner, created, publications, repository };
}

function publication(ownerId: string, status: string, revision = 1) {
  return {
    ownerId: new Types.ObjectId(ownerId),
    previewId: `publication-${status}-${revision}`,
    status,
    scheduleRevision: revision,
    scheduledAt: new Date("2026-09-22T10:35:00.000Z"),
    scheduledTimezone: "Asia/Kolkata",
    updatedAt: new Date("2026-09-22T10:20:00.000Z"),
    publishedAt: null,
    _id: new Types.ObjectId(),
  };
}

test("reconciliation is owner scoped, idempotent, and reminds only future scheduled jobs", async () => {
  const { owner, otherOwner, publications, repository, created } = setup();
  const now = new Date("2026-09-22T10:24:44.000Z");
  publications.push(publication(owner, "scheduled"), publication(otherOwner, "scheduled"));
  await reconcileLinkedInNotifications(now, repository);
  await reconcileLinkedInNotifications(now, repository);
  assert.equal(created.length, 2);
  assert.equal(created.filter((value) => value.ownerId === owner).length, 1);
  assert.equal(created.some((value) => value.message.includes("Asia/Kolkata")), true);
});

test("rescheduling invalidates the old reminder and creates one for the new revision", async () => {
  const { owner, publications, repository, created } = setup();
  const now = new Date("2026-09-22T10:24:44.000Z");
  const item = publication(owner, "scheduled", 1);
  publications.push(item);
  await reconcileLinkedInNotifications(now, repository);
  item.scheduleRevision = 2;
  await reconcileLinkedInNotifications(now, repository);
  assert.equal(created.filter((value) => value.type === "scheduled_reminder" && !value.obsoleteAt).length, 1);
  assert.equal(created.filter((value) => value.obsoleteAt).length, 1);
});

test("outcomes preserve uncertain wording and do not imply a retry", async () => {
  const { owner, publications, repository, created } = setup();
  publications.push(publication(owner, "uncertain"));
  await reconcileLinkedInNotifications(new Date("2026-09-22T10:24:44.000Z"), repository);
  assert.match(created[0].message, /uncertain|Check LinkedIn/i);
  assert.equal(created[0].type, "uncertain");
});

test("explicit displayed IDs do not mark another page and are idempotent", async () => {
  const { owner, otherOwner, repository, created } = setup();
  const displayed = { _id: new Types.ObjectId(), ownerId: owner, readAt: null, obsoleteAt: null };
  const olderOtherPage = { _id: new Types.ObjectId(), ownerId: owner, readAt: null, obsoleteAt: null };
  const otherOwnersNotification = { _id: new Types.ObjectId(), ownerId: otherOwner, readAt: null, obsoleteAt: null };
  created.push(displayed, olderOtherPage, otherOwnersNotification);
  assert.equal(await getUnreadNotificationCount(owner, repository), 2);
  const ids = [displayed._id.toString(), displayed._id.toString(), otherOwnersNotification._id.toString()];
  await readDisplayedNotifications(owner, ids, repository);
  await readDisplayedNotifications(owner, ids, repository);
  assert.equal(await getUnreadNotificationCount(owner, repository), 1);
  assert.equal(olderOtherPage.readAt, null);
  assert.equal(otherOwnersNotification.readAt, null);
});

test("a publication beyond the first bounded page is eventually reconciled", async () => {
  const { owner, repository, publications, created } = setup();
  for (let index = 0; index < 100; index += 1) publications.push({ ...publication(owner, "published"), _id: new Types.ObjectId() });
  publications.push({ ...publication(owner, "published"), previewId: "outside-page", _id: new Types.ObjectId() });
  const cursor = await reconcileLinkedInNotifications(new Date("2026-09-22T10:24:44.000Z"), repository);
  await reconcileLinkedInNotifications(new Date("2026-09-22T10:24:44.000Z"), repository, cursor);
  assert.equal(created.some((value) => value.publicationId === "outside-page"), true);
});

test("a failed notification write does not starve later records and succeeds on a later pass", async () => {
  const { owner, repository, publications, created } = setup();
  publications.push({ ...publication(owner, "published"), previewId: "first", _id: new Types.ObjectId() });
  publications.push({ ...publication(owner, "published"), previewId: "second", _id: new Types.ObjectId() });
  let fail = true;
  const original = repository.create;
  repository.create = async (input) => {
    if (fail && input.eventKey === "publication:first:outcome:published") {
      fail = false;
      throw new Error("temporary write failure");
    }
    return original(input);
  };
  const cursor = await reconcileLinkedInNotifications(new Date("2026-09-22T10:24:44.000Z"), repository);
  assert.equal(created.some((value) => value.publicationId === "second"), true);
  await reconcileLinkedInNotifications(new Date("2026-09-22T10:24:44.000Z"), repository, cursor);
  assert.equal(created.some((value) => value.publicationId === "first"), true);
});

test("cancelled publications obsolete existing reminders", async () => {
  const { owner, repository, publications, created } = setup();
  const item = { ...publication(owner, "scheduled", 1), _id: new Types.ObjectId() };
  publications.push(item);
  await reconcileLinkedInNotifications(new Date("2026-09-22T10:24:44.000Z"), repository);
  item.status = "cancelled";
  await reconcileLinkedInNotifications(new Date("2026-09-22T10:24:44.000Z"), repository);
  assert.equal(created[0].obsoleteAt instanceof Date, true);
});

test("new notifications after a displayed snapshot remain unread", async () => {
  const { owner, repository, created } = setup();
  const old = { _id: new Types.ObjectId(), ownerId: owner, readAt: null, obsoleteAt: null, createdAt: new Date("2026-09-22T10:00:00.000Z") };
  const newer = { _id: new Types.ObjectId(), ownerId: owner, readAt: null, obsoleteAt: null, createdAt: new Date("2026-09-22T10:30:00.000Z") };
  created.push(old);
  created.push(newer);
  await readDisplayedNotifications(owner, [old._id.toString()], repository);
  assert.equal(old.readAt instanceof Date, true);
  assert.equal(newer.readAt, null);
});
