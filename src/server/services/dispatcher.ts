import { applyStatus, canTransition } from "@/core/notification-status";
import type { EmergencyEvent, EmergencyResponse, ResponseStatus, UserProfile } from "@/core/types";
import { isFirebaseAdminConfigured } from "../env";
import { adminMessaging } from "../firebase-admin";
import { nowISO } from "../ids";
import { getStore } from "../store";
import { StoreError } from "../store/errors";
import { COLLECTIONS } from "../store/types";
import { createNotification } from "./notifications";

/** Deterministic in-app alert id: one inbox alert per response, however many send attempts. */
export const alertNotificationId = (responseId: string) => `ntf_alert_${responseId}`;

/** How long one request may hold a queued alert while sending it (E5.1). */
export const DISPATCH_LEASE_MS = 30_000;

/**
 * Claims a still-QUEUED alert for sending, in a transaction. Returns null if it is no longer
 * queued (already sent, answered, failed) or another request holds a live lease on it. Only the
 * claimer sends, so concurrent duplicate SOS requests can't send the same alert twice.
 */
async function claimForDispatch(r: EmergencyResponse): Promise<EmergencyResponse | null> {
  const now = Date.now();
  return getStore().transact<EmergencyResponse>(COLLECTIONS.emergencyResponses, r.id, (cur) => {
    if (cur.status !== "queued") return null;
    if (cur.dispatchLeaseUntil && new Date(cur.dispatchLeaseUntil).getTime() > now) return null;
    return { dispatchLeaseUntil: new Date(now + DISPATCH_LEASE_MS).toISOString(), dispatchAttempts: (cur.dispatchAttempts ?? 0) + 1 };
  });
}

/**
 * Sends every given alert that is still queued, each independently (E5.1). Call ONLY after the
 * transaction that created the responses committed. One recipient's failure never stops the
 * others, and never throws: a failed alert stays "queued" (honestly shown as such) and is retried
 * by the next duplicate SOS request once its lease expires. Delivery is never guaranteed.
 */
export async function dispatchQueuedAlerts(event: EmergencyEvent, responses: EmergencyResponse[]) {
  const store = getStore();
  const settled = await Promise.allSettled(
    responses.map(async (r) => {
      const claimed = await claimForDispatch(r);
      if (!claimed) return { response: (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, r.id)) ?? r, sent: false };
      return { response: await dispatchAlert(event, claimed), sent: true };
    }),
  );
  let failed = 0;
  const out = await Promise.all(
    settled.map(async (s, i) => {
      if (s.status === "fulfilled") return s.value.response;
      failed++;
      console.error("[dispatch] alert could not be sent; it stays queued for retry", responses[i].id, s.reason);
      return (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, responses[i].id).catch(() => null)) ?? responses[i];
    }),
  );
  return { responses: out, failed };
}

/**
 * Records a dispatch outcome WITHOUT ever overwriting what the recipient did.
 *
 * Read-modify-write in one transaction, and only FORWARD (core/notification-status): if the
 * recipient already opened or answered the alert (delivered / acknowledged / declined) while we
 * were still sending, their status is kept and ours is simply not recorded.
 */
async function advance(r: EmergencyResponse, to: ResponseStatus, detail: string): Promise<EmergencyResponse> {
  const store = getStore();
  const updated = await store.transact<EmergencyResponse>(COLLECTIONS.emergencyResponses, r.id, (cur) =>
    cur.status === to || !canTransition(cur.status, to) ? null : applyStatus(cur, to, nowISO(), detail),
  );
  return updated ?? (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, r.id)) ?? r;
}

/**
 * Delivers one emergency alert to one trusted contact, recording ONLY the
 * states that a system actually confirmed:
 *
 *  - "sent"      — our in-app inbox write succeeded and/or FCM accepted the push.
 *                  (FCM acceptance is NOT delivery; we never claim it is.)
 *  - "delivered" — set later, when the recipient's own client fetches the alert
 *                  (see emergencies.markDeliveredForRecipient).
 *  - "failed"    — no channel could reach the contact; the reason is stored.
 *
 * SMS/email providers are not integrated yet; contacts without a SafeHer
 * account are reported as failed with an explicit reason rather than faked.
 *
 * Called only AFTER the transaction that created the response has committed.
 */
export async function dispatchAlert(event: EmergencyEvent, response: EmergencyResponse): Promise<EmergencyResponse> {
  const store = getStore();
  const r = response;

  if (!r.contactUserId) {
    return advance(r, "failed", "Contact has not joined SafeHer yet. SMS/email alerts are not configured, so they could not be reached — call them directly.");
  }

  const isEscalation = r.tier === "secondary" && event.escalationLevel > 0;
  const prefix = event.isSimulated ? "[SIMULATED] " : "";
  const details: string[] = [];

  try {
    await createNotification({
      // Fixed per response (E5.1): a retried send can't duplicate the alert in the contact's inbox.
      id: alertNotificationId(r.id),
      recipientUserId: r.contactUserId,
      type: "emergency_alert",
      title: `${prefix}${isEscalation ? "Escalated emergency" : "Emergency alert"} from ${event.userName}`,
      body: event.location
        ? `${event.userName} triggered SOS. Open to see their shared location and respond.`
        : `${event.userName} triggered SOS. Location was not available. Try calling them now.`,
      link: `/emergency/${event.id}`,
      eventId: event.id,
      isSimulated: event.isSimulated,
    });
    details.push("in-app inbox");
  } catch (err) {
    if (err instanceof StoreError && err.code === "already_exists") {
      details.push("in-app inbox"); // written by an earlier attempt that didn't finish recording "sent"
    } else {
      console.error("[dispatch] in-app notification failed", err);
    }
  }

  // Push via FCM — never for simulated events, never in emulator mode (FCM isn't emulated).
  if (!event.isSimulated && isFirebaseAdminConfigured()) {
    const contact = await store.get<UserProfile>(COLLECTIONS.users, r.contactUserId);
    const tokens = contact?.fcmTokens ?? [];
    if (tokens.length > 0) {
      try {
        const res = await adminMessaging().sendEachForMulticast({
          tokens,
          notification: { title: `Emergency alert from ${event.userName}`, body: "Tap to view and respond." },
          data: { eventId: event.id, type: "emergency_alert", link: `/emergency/${event.id}` },
          android: { priority: "high" },
          apns: { headers: { "apns-priority": "10" } },
          webpush: { headers: { Urgency: "high" }, fcmOptions: { link: `/emergency/${event.id}` } },
        });
        if (res.successCount > 0) details.push(`push accepted by FCM (${res.successCount}/${tokens.length} devices)`);
      } catch (err) {
        console.error("[dispatch] FCM send failed", err);
      }
    }
  }

  return details.length > 0
    ? advance(r, "sent", `Via ${details.join(" + ")}`)
    : advance(r, "failed", "All delivery channels failed");
}
