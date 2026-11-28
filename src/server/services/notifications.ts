import type { AppNotification, NotificationType } from "@/core/types";
import { forbidden, notFound } from "../errors";
import { newId, nowISO } from "../ids";
import { getStore } from "../store";
import { COLLECTIONS, where } from "../store/types";

export async function createNotification(input: {
  /**
   * Optional fixed id (E5.1). Emergency alerts use one derived from their response, so a retried
   * send can never put a second copy in the contact's inbox: the create fails with
   * StoreError("already_exists") instead. Everything else gets a random id, as before.
   */
  id?: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  eventId?: string | null;
  isSimulated?: boolean;
}): Promise<AppNotification> {
  const n: AppNotification = {
    id: input.id ?? newId("ntf"),
    recipientUserId: input.recipientUserId,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link ?? null,
    eventId: input.eventId ?? null,
    read: false,
    isSimulated: input.isSimulated ?? false,
    createdAt: nowISO(),
  };
  return getStore().create(COLLECTIONS.notifications, n);
}

export async function listNotifications(uid: string, limit = 50): Promise<AppNotification[]> {
  return getStore().query<AppNotification>(COLLECTIONS.notifications, {
    where: [where("recipientUserId", "==", uid)],
    orderBy: { field: "createdAt", direction: "desc" },
    limit,
  });
}

export async function markNotificationRead(uid: string, id: string): Promise<AppNotification> {
  const store = getStore();
  const n = await store.get<AppNotification>(COLLECTIONS.notifications, id);
  if (!n) throw notFound("Notification not found");
  if (n.recipientUserId !== uid) throw forbidden();
  return store.update<AppNotification>(COLLECTIONS.notifications, id, { read: true });
}

export async function markAllNotificationsRead(uid: string): Promise<number> {
  const store = getStore();
  const unread = await store.query<AppNotification>(COLLECTIONS.notifications, {
    where: [where("recipientUserId", "==", uid), where("read", "==", false)],
  });
  await Promise.all(unread.map((n) => store.update(COLLECTIONS.notifications, n.id, { read: true })));
  return unread.length;
}
