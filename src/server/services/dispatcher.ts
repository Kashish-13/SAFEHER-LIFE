import { applyStatus } from "@/core/notification-status";
import type { EmergencyEvent, EmergencyResponse, UserProfile } from "@/core/types";
import { isFirebaseAdminConfigured } from "../env";
import { adminMessaging } from "../firebase-admin";
import { nowISO } from "../ids";
import { getStore } from "../store";
import { COLLECTIONS } from "../store/types";
import { createNotification } from "./notifications";

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
 */
export async function dispatchAlert(event: EmergencyEvent, response: EmergencyResponse): Promise<EmergencyResponse> {
  const store = getStore();
  let r = response;
  const save = async () => store.update<EmergencyResponse>(COLLECTIONS.emergencyResponses, r.id, r);

  if (!r.contactUserId) {
    r = applyStatus(r, "failed", nowISO(), "Contact has not joined SafeHer yet. SMS/email alerts are not configured, so they could not be reached — call them directly.");
    return save();
  }

  const isEscalation = r.tier === "secondary" && event.escalationLevel > 0;
  const prefix = event.isSimulated ? "[SIMULATED] " : "";
  const details: string[] = [];

  try {
    await createNotification({
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
    console.error("[dispatch] in-app notification failed", err);
  }

  // Push via FCM — never for simulated events.
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

  r = details.length > 0
    ? applyStatus(r, "sent", nowISO(), `Via ${details.join(" + ")}`)
    : applyStatus(r, "failed", nowISO(), "All delivery channels failed");
  return save();
}
