import { emergencyAccess } from "@/core/permissions";
import type { EmergencyEvent, EmergencyResponse, TrustedContact } from "@/core/types";
import { getStore } from "../store";
import { COLLECTIONS, where } from "../store/types";
import { markDeliveredForRecipient } from "./emergencies";

/** Only alerts created in this window are considered for the "someone needs help" banner. */
const ALERT_LOOKBACK_MS = 72 * 3_600_000;

/**
 * Everything the app shell needs, in ONE bounded call (replaces three polls).
 * Designed for Firestore's free quota: limit-1 queries, aggregate counts, and a
 * time-bounded alert lookup, never "read my whole history every few seconds".
 */
export async function getSafetyStatus(uid: string, now = new Date()) {
  const store = getStore();
  const since = new Date(now.getTime() - ALERT_LOOKBACK_MS).toISOString();

  const [activeList, recentResponses, unreadNotifications, pendingApprovals] = await Promise.all([
    store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, { where: [where("userId", "==", uid), where("status", "==", "active")], limit: 1 }),
    store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, { where: [where("contactUserId", "==", uid), where("createdAt", ">=", since)], limit: 20 }),
    store.count(COLLECTIONS.notifications, { where: [where("recipientUserId", "==", uid), where("read", "==", false)] }),
    store.count(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", uid), where("status", "==", "awaiting_approval")] }),
  ]);

  const incomingAlerts = [];
  for (const r of recentResponses) {
    const event = await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, r.eventId);
    if (!event || event.status !== "active") continue;
    const links = await store.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", event.userId), where("contactUserId", "==", uid)] });
    const linkActive = links.some((l) => l.status === "accepted");
    if (!emergencyAccess({ uid, roles: [] }, event, { now, linkActive }).allowed) continue;
    // The alert is now displayed on the recipient's own device: that is real confirmation of delivery.
    await markDeliveredForRecipient(event.id, uid);
    incomingAlerts.push({
      eventId: event.id, fromName: event.userName, status: event.status, isSimulated: event.isSimulated,
      createdAt: event.createdAt, myResponse: r.status === "sent" ? "delivered" : r.status,
    });
  }

  return { activeEmergency: activeList[0] ?? null, incomingAlerts, unreadNotifications, pendingApprovals };
}
