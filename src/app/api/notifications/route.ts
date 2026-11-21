import { authed } from "@/server/http";
import { markDeliveredForRecipient } from "@/server/services/emergencies";
import { listNotifications, markAllNotificationsRead } from "@/server/services/notifications";

/**
 * The caller's inbox. Fetching an emergency alert here is confirmation that it
 * reached the recipient's device, so the matching alert response moves to "delivered".
 */
export const GET = authed(async ({ auth }) => {
  const notifications = await listNotifications(auth.uid);
  const alertEventIds = new Set(notifications.filter((n) => n.type === "emergency_alert" && n.eventId).map((n) => n.eventId!));
  await Promise.all([...alertEventIds].map((id) => markDeliveredForRecipient(id, auth.uid)));
  return { notifications, unread: notifications.filter((n) => !n.read).length };
});

export const PATCH = authed(async ({ auth }) => ({ updated: await markAllNotificationsRead(auth.uid) }));
