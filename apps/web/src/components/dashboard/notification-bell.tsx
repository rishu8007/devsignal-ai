"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api/api-client";
import { getUnreadNotificationCount, listNotifications, markDisplayedNotificationsRead, markNotificationRead, type AppNotification } from "@/lib/api/notification-client";

export function NotificationBell({ active, onOpenRelated }: { active: boolean; onOpenRelated: (publicationId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(showItems = false) {
    setLoading(true);
    setError(null);
    try {
      const count = await getUnreadNotificationCount();
      setUnread(count);
      if (showItems) {
        const result = await listNotifications();
        setItems(result);
      }
    } catch (cause) {
      if (!(cause instanceof ApiClientError && cause.code === "REQUEST_ABORTED")) {
        setError(cause instanceof ApiClientError ? cause.message : "Notifications could not be loaded.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    const initial = window.setTimeout(() => void load(), 0);
    let timer: number | null = document.visibilityState === "visible" ? window.setInterval(() => void load(), 60_000) : null;
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
      } else if (timer === null) {
        void load();
        timer = window.setInterval(() => void load(), 60_000);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initial);
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [active]);

  async function read(item: AppNotification) {
    if (!item.readAt) {
      try {
        await markNotificationRead(item.id);
        setItems((current) => current.map((value) => value.id === item.id ? { ...value, readAt: new Date().toISOString() } : value));
        setUnread((current) => Math.max(0, current - 1));
      } catch (cause) {
        setError(cause instanceof ApiClientError ? cause.message : "The notification could not be marked read.");
      }
    }

  }

  async function markDisplayed() {
    const notificationIds = items.filter((item) => !item.obsoleteAt).slice(0, 50).map((item) => item.id);
    if (notificationIds.length === 0) return;
    try {
      await markDisplayedNotificationsRead(notificationIds);
      setItems((current) => current.map((item) => notificationIds.includes(item.id) && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item));
      setUnread((current) => Math.max(0, current - items.filter((item) => notificationIds.includes(item.id) && !item.readAt && !item.obsoleteAt).length));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Displayed notifications could not be marked read.");
    }
  }

  return (
    <div className="relative">
      <button type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} onClick={() => { setOpen((value) => !value); if (!open) void load(true); }} className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100">
        <Bell className="size-5" aria-hidden="true" />
        {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-indigo-600 px-1 text-center text-xs font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <section aria-label="Notification inbox" className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Notifications</h2>
            <button type="button" className="text-xs text-indigo-700" onClick={() => setOpen(false)}>Close</button>
            <button type="button" className="text-xs text-indigo-700" onClick={() => void markDisplayed()}>Mark displayed read</button>
          </div>
          {loading && <p className="py-4 text-sm text-slate-500">Loading notifications...</p>}
          {error && <p className="py-4 text-sm text-red-700">{error}</p>}
          {!loading && !error && items.length === 0 && <p className="py-4 text-sm text-slate-500">No notifications yet.</p>}
          <div className="mt-2 grid gap-2">
            {items.filter((item) => !item.obsoleteAt).map((item) => (
              <button key={item.id} type="button" onClick={() => { void read(item); onOpenRelated(item.publicationId); }} className={`rounded-lg border p-3 text-left ${item.readAt ? "border-slate-100 bg-white" : "border-indigo-100 bg-indigo-50"}`}>
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-1 text-sm text-slate-700">{item.message}</p>
                <p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
