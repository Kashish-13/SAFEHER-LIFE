import { evaluateEscalation, selectInitialRecipients } from "@/core/escalation";
import { applyStatus, canTransition, summarizeResponses } from "@/core/notification-status";
import { ACCESS_DENIED_MESSAGES, canManageEmergency, emergencyAccess, viewerAccessExpiry, type Principal } from "@/core/permissions";
import type { ActiveEmergencyLock, EmergencyCircle, EmergencyEvent, EmergencyResponse, EmergencyTrigger, GeoPoint, TrustedContact, UserProfile } from "@/core/types";
import { audit } from "../audit";
import { isDemoMode } from "../env";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../errors";
import { StoreError } from "../store/errors";
import { newId, nowISO } from "../ids";
import { getStore } from "../store";
import { COLLECTIONS, where, type WriteOp } from "../store/types";
import { batchInChunks } from "../store/batching";
import { dispatchQueuedAlerts } from "./dispatcher";
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
/** Shown when an SOS can't be recorded safely. The person may be in danger: always point to 112. */
const SOS_UNAVAILABLE = "We couldn't raise your alert right now. Call 112 immediately, then try again.";
/** Extra attempts after the store's own 5 transaction retries, before telling the user to call 112. */
const SOS_EXTRA_ATTEMPTS = 2;

/**
 * Outside demo mode a `voice_simulated` trigger is a TEST of the voice pipeline. It is recorded
 * already CLOSED, never takes the SOS lock and alerts nobody, so it can never be mistaken for, or
 * suppress, a real emergency. (In demo mode everything is simulated and it behaves like an SOS.)
 */
const isVoiceTest = (trigger: EmergencyTrigger) => trigger === "voice_simulated" && !isDemoMode();

/** An event that blocks a new SOS: active, and not a voice test (legacy test records included). */
const blocksNewSos = (e: EmergencyEvent | null): e is EmergencyEvent => Boolean(e && e.status === "active" && !isVoiceTest(e.trigger));

async function recordVoiceTest(user: UserProfile, input: CreateEmergencyInput) {
  const now = nowISO();
  const event: EmergencyEvent = {
    id: newId("sos"), userId: user.id, userName: user.fullName, trigger: input.trigger, status: "cancelled",
    location: null, escalationLevel: 0, escalationConfig: { ...user.emergencyPreferences.escalation, enabled: false },
    isSimulated: true, authorizedViewerIds: [], viewerAccessExpiresAt: now, viewerAccessOpen: false,
    note: "Simulated voice trigger test. No contacts were alerted.",
    createdAt: now, updatedAt: now, cancelledAt: now, resolvedAt: null,
  };
  await getStore().create(COLLECTIONS.emergencyEvents, event);
  await audit(user.id, "emergency.voice_test", "emergencyEvent", event.id, { simulated: true });
  return { event, responses: [] as EmergencyResponse[], deduplicated: false, pendingAlerts: 0 };
}

/**
 * Creates an emergency and alerts the first tier of contacts simultaneously.
 *
 * Duplicate-proof: ONE transaction reads the per-user lock (activeEmergencies/{userId}), the
 * user's active events, contacts and circles, then writes the lock, the event and every
 * first-tier response together. A second press (or a second device) racing it is re-run by the
 * store, sees the lock, and gets the existing event back (`deduplicated: true`). A lock pointing
 * at a missing/closed event is stale and is replaced. Alerts and audit run only after commit.
 */
export async function createEmergency(user: UserProfile, input: CreateEmergencyInput) {
  if (isVoiceTest(input.trigger)) return recordVoiceTest(user, input);
  const store = getStore();

  type Outcome = { existing: EmergencyEvent } | { event: EmergencyEvent; responses: EmergencyResponse[]; recipients: number };
  let outcome: Outcome | null = null;
  for (let attempt = 0; attempt <= SOS_EXTRA_ATTEMPTS && !outcome; attempt++) {
    try {
      outcome = await store.runTransaction<Outcome>(async (tx) => {
        // ── reads ──
        const lock = await tx.get<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, user.id);
        const locked = lock ? await tx.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, lock.eventId) : null;
        // Also catches active events from before the lock existed, and legacy open voice tests.
        const actives = await tx.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, {
          where: [where("userId", "==", user.id), where("status", "==", "active")],
        });
        const contacts = await tx.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", user.id)] });
        // Scope: explicit ids > requested circles > preference circles > everyone.
        let scope: string[] | null = input.contactIds ?? null;
        const circleIds = input.circleIds?.length ? input.circleIds : user.emergencyPreferences.notifyCircleIds;
        if (!scope && circleIds.length > 0) {
          const circles = await tx.query<EmergencyCircle>(COLLECTIONS.emergencyCircles, { where: [where("ownerId", "==", user.id)] });
          scope = circles.filter((c) => circleIds.includes(c.id)).flatMap((c) => c.contactIds);
        }

        // ── decide ──
        const now = nowISO();
        const current = blocksNewSos(locked) ? locked : actives.find(blocksNewSos) ?? null;
        // Legacy voice tests left open (before this fix) are closed so they can never block again.
        const staleTests = actives.filter((e) => isVoiceTest(e.trigger));
        if (current) {
          for (const t of staleTests) tx.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, t.id, closedVoiceTestPatch(now));
          if (!lock) tx.create<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, { id: user.id, userId: user.id, eventId: current.id, createdAt: now });
          else if (lock.eventId !== current.id) tx.update<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, user.id, { eventId: current.id });
          return { existing: current };
        }

        const { recipients } = selectInitialRecipients(contacts, scope);
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
          note: input.note ?? null,
          createdAt: now,
          updatedAt: now,
          cancelledAt: null,
          resolvedAt: null,
        };
        const responses = recipients.map((c) => newResponse(event, c, c.priority));

        // ── writes (lock + event + responses: all or nothing) ──
        for (const t of staleTests) tx.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, t.id, closedVoiceTestPatch(now));
        if (lock) tx.update<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, user.id, { eventId: event.id, createdAt: now });
        else tx.create<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, { id: user.id, userId: user.id, eventId: event.id, createdAt: now });
        tx.create(COLLECTIONS.emergencyEvents, event);
        for (const r of responses) tx.create(COLLECTIONS.emergencyResponses, r);
        return { event, responses, recipients: recipients.length };
      });
    } catch (err) {
      // Contention or a backend hiccup: try again a couple of times, then send the person to 112.
      // `already_exists` (E5.1, audit L3): the only document this transaction creates with a fixed id
      // is the per-user lock (the event id is new on every attempt, and response ids derive from it),
      // so it means a concurrent SOS created the lock first. Re-running re-reads that lock and returns
      // the REAL existing emergency; it can't invent a duplicate. Anything else is not retried.
      const retriable = err instanceof StoreError && ["aborted", "unavailable", "already_exists"].includes(err.code);
      if (retriable && attempt < SOS_EXTRA_ATTEMPTS) continue;
      if (err instanceof StoreError) {
        console.error("[sos] could not create emergency", err.code, err.message);
        throw new ApiError(503, "sos_unavailable", SOS_UNAVAILABLE);
      }
      throw err;
    }
  }
  if (!outcome) throw new ApiError(503, "sos_unavailable", SOS_UNAVAILABLE);

  if ("existing" in outcome) {
    // E5.1 (audit H1): the SOS already exists. If some of its alerts never left (the sender crashed
    // or failed after the commit), send those now. Only responses still QUEUED are retried; anything
    // sent, delivered, answered or failed is never re-sent, and a lease stops concurrent duplicate
    // requests from sending the same alert twice.
    const existing = outcome.existing;
    const queued = (await listResponses(existing.id)).filter((r) => r.status === "queued");
    let pendingAlerts = 0;
    if (queued.length) pendingAlerts = (await dispatchQueuedAlerts(existing, queued)).failed;
    return { event: existing, responses: await listResponses(existing.id), deduplicated: true, pendingAlerts };
  }
  // Side effects only after the commit succeeded.
  const { event } = outcome;
  await audit(user.id, "emergency.created", "emergencyEvent", event.id, { trigger: event.trigger, recipients: outcome.recipients, hasLocation: !!event.location, simulated: event.isSimulated });
  // In parallel: everyone is alerted simultaneously. A failure for one recipient never stops the
  // others and never turns a SAVED emergency into an error: that alert stays queued and is retried.
  const { responses, failed } = await dispatchQueuedAlerts(event, outcome.responses);
  if (failed) console.error(`[sos] ${failed} alert(s) for ${event.id} could not be sent yet; they stay queued for retry`);
  return { event, responses, deduplicated: false, pendingAlerts: failed };
}

const closedVoiceTestPatch = (now: string): Partial<EmergencyEvent> => ({
  status: "cancelled", cancelledAt: now, updatedAt: now, viewerAccessExpiresAt: now, viewerAccessOpen: false, authorizedViewerIds: [],
});

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
  const events = await getStore().query<EmergencyEvent>(COLLECTIONS.emergencyEvents, {
    where: [where("userId", "==", uid)],
    orderBy: { field: "createdAt", direction: "desc" },
    limit: 100,
  });
  // Newest first; the id breaks ties so both stores give the same order.
  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
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

/** Recipient's client fetched the alert → "delivered" (from "queued" or "sent"; never backwards). */
export async function markDeliveredForRecipient(eventId: string, contactUserId: string) {
  const store = getStore();
  const rs = await store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, {
    where: [where("eventId", "==", eventId), where("contactUserId", "==", contactUserId)],
  });
  const opened = (s: EmergencyResponse["status"]) => s === "queued" || s === "sent";
  for (const r of rs) {
    if (!opened(r.status)) continue;
    await store.transact<EmergencyResponse>(COLLECTIONS.emergencyResponses, r.id, (cur) =>
      opened(cur.status) ? applyStatus(cur, "delivered", nowISO(), "Opened on recipient's device") : null,
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
  const updated = await store.transact<EmergencyResponse>(COLLECTIONS.emergencyResponses, response.id, (cur) => {
    if (cur.status === to) return null; // already recorded
    if (!canTransition(cur.status, to)) {
      // "delivered" after the person already answered is simply already covered.
      if (action === "delivered") return null;
      throw conflict(cur.status === "acknowledged" || cur.status === "declined"
        ? "You've already responded to this alert"
        : "This alert can't be answered right now");
    }
    return applyStatus(cur, to, nowISO());
  });
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
  // Close the event and release the per-user SOS lock in ONE transaction, so a new SOS can never
  // see a closed event as active, nor a released lock while the event is still active.
  const updated = await store.runTransaction(async (tx) => {
    const cur = await tx.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId);
    const lock = await tx.get<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, event.userId);
    if (!cur || cur.status !== "active") return null;
    const now = nowISO();
    // Contacts keep access for 24 h after closure, for both resolved AND cancelled events.
    const viewerAccessExpiresAt = viewerAccessExpiry(now);
    const patch: Partial<EmergencyEvent> = action === "cancel"
      ? { status: "cancelled", cancelledAt: now, updatedAt: now, viewerAccessExpiresAt, viewerAccessOpen: true, note: note ?? cur.note }
      : { status: "resolved", resolvedAt: now, updatedAt: now, viewerAccessExpiresAt, viewerAccessOpen: true, note: note ?? cur.note };
    tx.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId, patch);
    if (lock?.eventId === eventId) tx.delete(COLLECTIONS.activeEmergencies, event.userId);
    return { ...cur, ...patch } as EmergencyEvent;
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

const ACCESS_SWEEP_PAGE = 200;
const ACCESS_SWEEP_MAX_PAGES = 25; // bounded work per run; the next run continues

/**
 * Sweep: after the 24 h window, physically removes viewers from closed events so
 * access is revoked in stored data too, not only by the API's time check.
 *
 * Only events still flagged `viewerAccessOpen` are read, so already-swept events can never fill
 * the page and starve newer ones. Each event is re-checked and cleared in its own transaction
 * (closed, expired, still open), which makes the sweep idempotent and safe to run concurrently.
 * Events closed before this flag existed are not visited; the API time check still blocks them.
 */
export async function applyAccessExpiry(now = new Date()) {
  const store = getStore();
  const cutoff = now.toISOString();
  let revoked = 0;
  for (let page = 0; page < ACCESS_SWEEP_MAX_PAGES; page++) {
    const due = await store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, {
      where: [where("viewerAccessOpen", "==", true), where("viewerAccessExpiresAt", "<=", cutoff)],
      limit: ACCESS_SWEEP_PAGE,
    });
    let progressed = 0;
    for (const e of due) {
      let hadViewers = false;
      const done = await store.transact<EmergencyEvent>(COLLECTIONS.emergencyEvents, e.id, (cur) => {
        if (cur.viewerAccessOpen !== true || cur.status === "active") return null;
        if (!cur.viewerAccessExpiresAt || cur.viewerAccessExpiresAt > cutoff) return null;
        hadViewers = cur.authorizedViewerIds.length > 0;
        return { authorizedViewerIds: [], viewerAccessOpen: false, updatedAt: nowISO() };
      });
      if (done) {
        progressed++;
        if (hadViewers) revoked++;
      }
    }
    if (due.length < ACCESS_SWEEP_PAGE || progressed === 0) break; // done, or nothing more we can clear
  }
  if (revoked) await audit(null, "emergency.viewer_access_expired", "emergencyEvent", null, { events: revoked });
  return { revoked };
}

/**
 * Runs the escalation policy for an event. Idempotent and safe to call concurrently.
 *
 * ONE transaction reads the event, its responses and the owner's contacts, decides, and writes
 * the escalation flag, the new viewers and every secondary response together. So a crash can no
 * longer leave the flag set with secondary contacts never alerted, and concurrent callers are
 * serialised: the loser is re-run, sees escalationLevel 1, and does nothing. Alerts, the owner's
 * notification and the audit entry run only after the commit.
 */
export async function runEscalation(eventId: string, now = new Date()) {
  const store = getStore();
  const result = await store.runTransaction(async (tx) => {
    const event = await tx.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId);
    if (!event) throw notFound("Emergency not found");
    const responses = await tx.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, { where: [where("eventId", "==", eventId)] });
    const contacts = await tx.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", event.userId)] });
    const decision = evaluateEscalation(event, responses, contacts, now);
    if (!decision.shouldEscalate) return { decision, event: null, created: [] as EmergencyResponse[] };

    const newViewerIds = decision.contactsToNotify.map((c) => c.contactUserId).filter((x): x is string => Boolean(x));
    const patch: Partial<EmergencyEvent> = {
      escalationLevel: 1,
      authorizedViewerIds: [...new Set([...event.authorizedViewerIds, ...newViewerIds])],
      updatedAt: nowISO(),
    };
    const escalatedEvent = { ...event, ...patch } as EmergencyEvent;
    const existingIds = new Set(responses.map((r) => r.id));
    const created = decision.contactsToNotify
      .map((c) => newResponse(escalatedEvent, c, "secondary"))
      .filter((r) => !existingIds.has(r.id)); // deterministic ids: never two responses per contact
    tx.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, eventId, patch);
    for (const r of created) tx.create(COLLECTIONS.emergencyResponses, r);
    return { decision, event: escalatedEvent, created };
  });
  const { decision } = result;
  if (!result.event) return { escalated: false, decision: { ...decision, contactsToNotify: [] } };

  const event = result.event;
  // Independent per recipient (E5.1): one failure doesn't stop the others or the owner's notice.
  const { responses: created, failed } = await dispatchQueuedAlerts(event, result.created);
  if (failed) console.error(`[escalation] ${failed} secondary alert(s) for ${eventId} could not be sent yet; they stay queued for retry`);
  await createNotification({
    recipientUserId: event.userId,
    type: "emergency_update",
    title: "Your alert was escalated",
    body: "No primary contact acknowledged in time, so your secondary contacts have been alerted.",
    link: `/emergency/${eventId}`,
    eventId,
    isSimulated: event.isSimulated,
  });
  await audit(null, "emergency.escalated", "emergencyEvent", eventId, { notified: created.length });
  return { escalated: true, decision: { ...decision, contactsToNotify: [] }, notified: created.length };
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
      // An event and its responses go together (batches of ≤ 500, the event in the LAST one), so a
      // failure never leaves an event without its responses, and the next run simply continues.
      const rs = await listResponses(e.id);
      const ops: WriteOp[] = [...rs.map((r) => ({ type: "delete" as const, collection: COLLECTIONS.emergencyResponses, id: r.id })), { type: "delete", collection: COLLECTIONS.emergencyEvents, id: e.id }];
      await batchInChunks(store, ops);
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
