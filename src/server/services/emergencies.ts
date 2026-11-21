import { evaluateEscalation, selectInitialRecipients } from "@/core/escalation";
import { applyStatus, summarizeResponses } from "@/core/notification-status";
import { ACCESS_DENIED_MESSAGES, canManageEmergency, emergencyAccess, viewerAccessExpiry, type Principal } from "@/core/permissions";
import type { EmergencyCircle, EmergencyEvent, EmergencyResponse, EmergencyTrigger, GeoPoint, TrustedContact, UserProfile } from "@/core/types";
import { audit } from "../audit";
import { isDemoMode } from "../env";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { newId, nowISO } from "../ids";
import { getStore } from "../store";
import { COLLECTIONS, where } from "../store/types";
import { dispatchAlert } from "./dispatcher";
import { createNotification } from "./notifications";

export interface CreateEmergencyInput {
  trigger: EmergencyTrigger;
  location: GeoPoint | null;
  note?: string | null;
  circleIds?: string[];
  /** Restrict recipients to these contact ids (used by Safe Journey escalation). */
  contactIds?: string[];
}

function newResponse(event: EmergencyEvent, c: TrustedContact, tier: "primary" | "secondary"): EmergencyResponse {
  const now = nowISO();
  return {
    id: `${event.id}__${c.id}`, // deterministic id → one response per contact per event (dedup)
    eventId: event.id,
    ownerId: event.userId,
    contactId: c.id,
    contactUserId: c.contactUserId,
    contactName: c.name,
    tier,
    channels: c.contactUserId ? ["in_app", "push"] : [],
    status: "queued",
    history: [{ status: "queued", at: now }],
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** True if `contactUserId` is currently an ACCEPTED trusted contact of `ownerId`. */
async function hasActiveLink(ownerId: string, contactUserId: string): Promise<boolean> {
  const links = await getStore().query<TrustedContact>(COLLECTIONS.trustedContacts, {
    where: [where("ownerId", "==", ownerId), where("contactUserId", "==", contactUserId)],
  });
  return links.some((l) => l.status === "accepted");
}

/**
 * Enforces emergency access (see core/permissions.emergencyAccess): owner always;
 * alerted contacts only while their link is accepted and within 24 h of closure.
 */
export async function assertEmergencyAccess(principal: Principal, event: EmergencyEvent, now = new Date()) {
  const linkActive = event.userId === principal.uid ? true : await hasActiveLink(event.userId, principal.uid);
  const access = emergencyAccess(principal, event, { now, linkActive });
  if (!access.allowed) throw forbidden(ACCESS_DENIED_MESSAGES[access.reason]);
  return access;
}

/**
 * Creates an emergency and alerts the first tier of contacts simultaneously.
 *
 * Works independently of voice detection: voice triggers (native app) and
 * manual SOS call this same function through POST /api/emergencies.
 */
export async function createEmergency(user: UserProfile, input: CreateEmergencyInput) {
  const store = getStore();

  // One active emergency at a time: a second press returns the existing event instead of duplicating alerts.
  const [active] = await store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, {
    where: [where("userId", "==", user.id), where("status", "==", "active")],
    limit: 1,
  });
  if (active) return { event: active, responses: await listResponses(active.id), deduplicated: true };

  const contacts = await store.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", user.id)] });

  // Resolve which contacts are in scope: explicit ids > requested circles > preference circles > everyone.
  let scope: string[] | null = input.contactIds ?? null;
  const circleIds = input.circleIds?.length ? input.circleIds : user.emergencyPreferences.notifyCircleIds;
  if (!scope && circleIds.length > 0) {
    const circles = await store.query<EmergencyCircle>(COLLECTIONS.emergencyCircles, { where: [where("ownerId", "==", user.id)] });
    scope = circles.filter((c) => circleIds.includes(c.id)).flatMap((c) => c.contactIds);
  }
  // A simulated trigger with real (non-demo) data is a DRY RUN: the event is recorded for the user
  // to inspect, but no real contact is alerted. Real people are never alerted by a test.
  const dryRun = input.trigger === "voice_simulated" && !isDemoMode();
  const { recipients } = dryRun ? { recipients: [] as TrustedContact[] } : selectInitialRecipients(contacts, scope);

  const now = nowISO();
  const shareLocation = user.emergencyPreferences.shareLocationOnSOS && input.location !== null;
  const event: EmergencyEvent = {
    id: newId("sos"),
    userId: user.id,
    userName: user.fullName,
    trigger: input.trigger,
    status: "active",
    location: shareLocation ? input.location : null,
    escalationLevel: 0,
    escalationConfig: user.emergencyPreferences.escalation,
    isSimulated: isDemoMode() || input.trigger === "voice_simulated",
    authorizedViewerIds: recipients.map((c) => c.contactUserId).filter((x): x is string => Boolean(x)),
    viewerAccessExpiresAt: null,
    note: dryRun ? "Simulated voice trigger test. No contacts were alerted." : input.note ?? null,
    createdAt: now,
    updatedAt: now,
    cancelledAt: null,
    resolvedAt: null,
  };
  if (dryRun) event.escalationConfig = { ...event.escalationConfig, enabled: false };
  await store.create(COLLECTIONS.emergencyEvents, event);
  await audit(user.id, "emergency.created", "emergencyEvent", event.id, { trigger: event.trigger, recipients: recipients.length, hasLocation: !!event.location, simulated: event.isSimulated });

  const responses = await Promise.all(
    recipients.map(async (c) => {
      const r = await store.create(COLLECTIONS.emergencyResponses, newResponse(event, c, c.priority));
      return dispatchAlert(event, r); // in parallel: everyone is alerted simultaneously
    }),
  );

  return { event, responses, deduplicated: false };
}

export async function getEmergency(principal: Principal, id: string) {
  const event = await getStore().get<EmergencyEvent>(COLLECTIONS.emergencyEvents, id);
  if (!event) throw notFound("Emergency not found");
  const access = await assertEmergencyAccess(principal, event);
  const isOwner = access.as === "owner";
  const responses = await listResponses(id);
  // When a recipient opens the event, their client has demonstrably received the alert.
  if (!isOwner) await markDeliveredForRecipient(id, principal.uid);
  // Contacts see statuses but not the per-channel delivery trail.
  const visible = isOwner ? responses : responses.map((r) => ({ ...r, history: [], failureReason: null }));
  return { event, responses: visible, summary: summarizeResponses(responses), viewerIsOwner: isOwner };
}

export async function listResponses(eventId: string) {
  const rs = await getStore().query<EmergencyResponse>(COLLECTIONS.emergencyResponses, { where: [where("eventId", "==", eventId)] });
  return rs.sort((a, b) => (a.tier === b.tier ? a.contactName.localeCompare(b.contactName) : a.tier === "primary" ? -1 : 1));
}

export async function listEmergencyHistory(uid: string) {
  return getStore().query<EmergencyEvent>(COLLECTIONS.emergencyEvents, {
    where: [where("userId", "==", uid)],
    orderBy: { field: "createdAt", direction: "desc" },
    limit: 100,
  });
}

/** Alerts addressed to the caller as a trusted contact, ONLY those they can still access. */
export async function listAlertsForContact(uid: string, now = new Date()) {
  const store = getStore();
  const rs = await store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, { where: [where("contactUserId", "==", uid)] });
  const linkCache = new Map<string, boolean>();
  const out: { response: EmergencyResponse; event: EmergencyEvent }[] = [];
  for (const r of rs) {
    const event = await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, r.eventId);
    if (!event) continue;
    if (!linkCache.has(event.userId)) linkCache.set(event.userId, await hasActiveLink(event.userId, uid));
    if (emergencyAccess({ uid, roles: [] }, event, { now, linkActive: linkCache.get(event.userId)! }).allowed) out.push({ response: r, event });
  }
  return out.sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt)).slice(0, 50);
}

/** Recipient's client fetched the alert → "delivered" (only from "sent"). */
export async function markDeliveredForRecipient(eventId: string, contactUserId: string) {
  const store = getStore();
  const rs = await store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, {
    where: [where("eventId", "==", eventId), where("contactUserId", "==", contactUserId)],
  });
  for (const r of rs) {
    if (r.status !== "sent") continue;
    await store.transact<EmergencyResponse>(COLLECTIONS.emergencyResponses, r.id, (cur) =>
      cur.status === "sent" ? applyStatus(cur, "delivered", nowISO(), "Opened on recipient's device") : null,
    );
  }
}

export async function respondToEmergency(principal: Principal, eventId: string, action: "delivered" | "acknowledge" | "decline") {
  const store = getStore();
  const event = await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId);
  if (!event) throw notFound("Emergency not found");
  await assertEmergencyAccess(principal, event);
  const [response] = await store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, {
    where: [where("eventId", "==", eventId), where("contactUserId", "==", principal.uid)],
    limit: 1,
  });
  if (!response) throw forbidden("You were not alerted for this emergency");
  if (action !== "delivered" && event.status !== "active") throw conflict("This emergency is no longer active");

  const to = action === "delivered" ? "delivered" : action === "acknowledge" ? "acknowledged" : "declined";
  const updated = await store.transact<EmergencyResponse>(COLLECTIONS.emergencyResponses, response.id, (cur) =>
    cur.status === to ? null : applyStatus(cur, to, nowISO()),
  );
  if (updated && action !== "delivered") {
    await createNotification({
      recipientUserId: event.userId,
      type: "emergency_update",
      title: action === "acknowledge" ? `${response.contactName} acknowledged your alert` : `${response.contactName} can't respond right now`,
      body: action === "acknowledge" ? "They have seen your emergency and are responding." : "Your other contacts are still being alerted.",
      link: `/emergency/${event.id}`,
      eventId: event.id,
      isSimulated: event.isSimulated,
    });
    await audit(principal.uid, `emergency.${action}`, "emergencyEvent", eventId);
  }
  return updated ?? response;
}

export async function closeEmergency(principal: Principal, eventId: string, action: "cancel" | "resolve", note?: string) {
  const store = getStore();
  const event = await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId);
  if (!event) throw notFound("Emergency not found");
  if (!canManageEmergency(principal, event)) throw forbidden("Only the person who raised the emergency can close it");
  const now = nowISO();
  // Contacts keep access for 24 h after closure, for both resolved AND cancelled events.
  const viewerAccessExpiresAt = viewerAccessExpiry(now);
  const updated = await store.transact<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId, (cur) => {
    if (cur.status !== "active") return null;
    return action === "cancel"
      ? { status: "cancelled", cancelledAt: now, updatedAt: now, viewerAccessExpiresAt, note: note ?? cur.note }
      : { status: "resolved", resolvedAt: now, updatedAt: now, viewerAccessExpiresAt, note: note ?? cur.note };
  });
  if (!updated) throw conflict("This emergency is already closed");

  // Tell everyone who was alerted that the person is now safe / it was a false alarm.
  const responses = await listResponses(eventId);
  await Promise.all(
    responses.filter((r) => r.contactUserId).map((r) =>
      createNotification({
        recipientUserId: r.contactUserId!,
        type: "emergency_update",
        title: action === "cancel" ? `${event.userName} cancelled the emergency alert` : `${event.userName} marked themselves safe`,
        body: action === "cancel" ? "The alert was cancelled. It may have been triggered by mistake." : "The emergency has been resolved.",
        link: `/emergency/${eventId}`,
        eventId,
        isSimulated: event.isSimulated,
      }),
    ),
  );
  await audit(principal.uid, `emergency.${action}`, "emergencyEvent", eventId);
  return updated;
}

/**
 * Immediately removes a contact's access to ALL of an owner's emergencies.
 * Called when the owner blocks/removes them, or when they leave the circle.
 */
export async function revokeViewerAccess(ownerId: string, contactUserId: string) {
  const store = getStore();
  const events = await store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, {
    where: [where("userId", "==", ownerId), where("authorizedViewerIds", "array-contains", contactUserId)],
  });
  await Promise.all(
    events.map((e) =>
      store.transact<EmergencyEvent>(COLLECTIONS.emergencyEvents, e.id, (cur) => ({
        authorizedViewerIds: cur.authorizedViewerIds.filter((x) => x !== contactUserId),
        updatedAt: nowISO(),
      })),
    ),
  );
  return { revokedEvents: events.length };
}

/**
 * Sweep: after the 24 h window, physically removes viewers from closed events so
 * access is revoked in stored data too, not only by the API's time check.
 */
export async function applyAccessExpiry(now = new Date()) {
  const store = getStore();
  const expired = await store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, {
    where: [where("viewerAccessExpiresAt", "<=", now.toISOString())],
    limit: 500,
  });
  let revoked = 0;
  for (const e of expired) {
    if (e.status === "active" || e.authorizedViewerIds.length === 0) continue;
    await store.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, e.id, { authorizedViewerIds: [], updatedAt: nowISO() });
    revoked++;
  }
  if (revoked) await audit(null, "emergency.viewer_access_expired", "emergencyEvent", null, { events: revoked });
  return { revoked };
}

/**
 * Runs the escalation policy for an event. Idempotent and safe to call
 * concurrently: the escalationLevel 0→1 flip happens in a transaction, and
 * only the caller that wins the flip dispatches secondary alerts.
 */
export async function runEscalation(eventId: string, now = new Date()) {
  const store = getStore();
  const event = await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId);
  if (!event) throw notFound("Emergency not found");
  const responses = await listResponses(eventId);
  const contacts = await store.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", event.userId)] });
  const decision = evaluateEscalation(event, responses, contacts, now);
  if (!decision.shouldEscalate) return { escalated: false, decision: { ...decision, contactsToNotify: [] } };

  const newViewerIds = decision.contactsToNotify.map((c) => c.contactUserId).filter((x): x is string => Boolean(x));
  const won = await store.transact<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId, (cur) =>
    cur.escalationLevel >= 1 || cur.status !== "active"
      ? null
      : { escalationLevel: 1, authorizedViewerIds: [...new Set([...cur.authorizedViewerIds, ...newViewerIds])], updatedAt: nowISO() },
  );
  if (!won) return { escalated: false, decision: { ...decision, reason: "already_escalated" as const, contactsToNotify: [] } };

  const created = await Promise.all(
    decision.contactsToNotify.map(async (c) => {
      const r = newResponse(won, c, "secondary");
      if (await store.get(COLLECTIONS.emergencyResponses, r.id)) return null; // dedup guard
      await store.create(COLLECTIONS.emergencyResponses, r);
      return dispatchAlert(won, r);
    }),
  );
  await createNotification({
    recipientUserId: event.userId,
    type: "emergency_update",
    title: "Your alert was escalated",
    body: "No primary contact acknowledged in time, so your secondary contacts have been alerted.",
    link: `/emergency/${eventId}`,
    eventId,
    isSimulated: event.isSimulated,
  });
  await audit(null, "emergency.escalated", "emergencyEvent", eventId, { notified: created.filter(Boolean).length });
  return { escalated: true, decision: { ...decision, contactsToNotify: [] }, notified: created.filter(Boolean).length };
}

export async function runAllEscalations(now = new Date()) {
  const active = await getStore().query<EmergencyEvent>(COLLECTIONS.emergencyEvents, { where: [where("status", "==", "active")], limit: 200 });
  let escalated = 0;
  for (const e of active) {
    try {
      if ((await runEscalation(e.id, now)).escalated) escalated++;
    } catch (err) {
      console.error("[escalation] failed for", e.id, err);
    }
  }
  return { checked: active.length, escalated };
}

/**
 * Retention: deletes CLOSED emergencies (and their responses) older than each
 * user's `privacy.historyRetentionDays`. Active emergencies are never deleted.
 */
export async function applyRetention(now = new Date()) {
  const store = getStore();
  const users = await store.query<UserProfile>(COLLECTIONS.users);
  let deleted = 0;
  for (const u of users) {
    const days = u.privacy?.historyRetentionDays ?? 0;
    if (days <= 0) continue;
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
    const old = await store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, { where: [where("userId", "==", u.id), where("createdAt", "<", cutoff)] });
    for (const e of old.filter((x) => x.status !== "active")) {
      const rs = await listResponses(e.id);
      await Promise.all(rs.map((r) => store.delete(COLLECTIONS.emergencyResponses, r.id)));
      await store.delete(COLLECTIONS.emergencyEvents, e.id);
      deleted++;
    }
  }
  if (deleted) await audit(null, "retention.applied", "emergencyEvent", null, { deleted });
  return { deleted };
}

export async function updateEmergencyLocation(principal: Principal, eventId: string, location: GeoPoint) {
  const store = getStore();
  const event = await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId);
  if (!event) throw notFound();
  if (!canManageEmergency(principal, event)) throw forbidden();
  if (event.status !== "active") throw badRequest("Emergency is not active");
  const user = await store.get<UserProfile>(COLLECTIONS.users, principal.uid);
  if (!user?.emergencyPreferences.shareLocationOnSOS) throw forbidden("Location sharing during SOS is turned off in your settings");
  return store.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId, { location, updatedAt: nowISO() });
}
