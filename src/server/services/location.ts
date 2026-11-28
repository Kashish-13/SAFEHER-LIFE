import { canViewLocation, effectiveStatus, isSessionLive } from "@/core/location-sharing";
import type { GeoPoint, LocationSession, TrustedContact, UserProfile } from "@/core/types";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import { newId, nowISO } from "../ids";
import { getStore } from "../store";
import { COLLECTIONS, where } from "../store/types";
import { createNotification } from "./notifications";

/**
 * Consent-based family location sharing.
 * - The owner explicitly picks each contact and mode; nothing is shared by default.
 * - Viewers only see a location while the session is active and unexpired.
 * - Location is pushed by the owner's device while the app is open; the web
 *   app never tracks in the background.
 */

export async function listMySessions(ownerId: string) {
  const now = new Date();
  const sessions = await getStore().query<LocationSession>(COLLECTIONS.locationSessions, { where: [where("ownerId", "==", ownerId)] });
  return sessions
    .filter((s) => s.status !== "stopped")
    .map((s) => ({ ...s, effectiveStatus: effectiveStatus(s, now) }))
    .sort((a, b) => a.contactName.localeCompare(b.contactName));
}

export async function startSharing(owner: UserProfile, input: { contactId: string; mode: "always" | "temporary"; durationMinutes?: number | null }) {
  const store = getStore();
  // The contact is re-checked INSIDE the transaction that writes the session. If the owner blocks
  // or removes the contact concurrently, either this sees the new status and refuses, or it commits
  // first and the block's clean-up (which runs after the block commits) stops this session.
  const { session, recipientUserId } = await store.runTransaction(async (tx) => {
    const contact = await tx.get<TrustedContact>(COLLECTIONS.trustedContacts, input.contactId);
    if (!contact || contact.ownerId !== owner.id) throw notFound("Contact not found");
    if (contact.status !== "accepted" || !contact.contactUserId) throw badRequest("You can only share with contacts who have accepted your invitation");
    const existing = (await tx.query<LocationSession>(COLLECTIONS.locationSessions, { where: [where("ownerId", "==", owner.id), where("contactId", "==", contact.id)] }))
      .find((s) => s.status !== "stopped");
    const now = nowISO();
    const expiresAt = input.mode === "temporary" ? new Date(Date.now() + (input.durationMinutes ?? 60) * 60_000).toISOString() : null;
    if (existing) {
      const patch: Partial<LocationSession> = { mode: input.mode, status: "active", expiresAt, updatedAt: now };
      tx.update<LocationSession>(COLLECTIONS.locationSessions, existing.id, patch);
      return { session: { ...existing, ...patch } as LocationSession, recipientUserId: contact.contactUserId };
    }
    const session: LocationSession = {
      id: newId("loc"), ownerId: owner.id, contactId: contact.id, contactUserId: contact.contactUserId, contactName: contact.name,
      mode: input.mode, status: "active", expiresAt, lastLocation: null, lastUpdatedAt: null, createdAt: now, updatedAt: now,
    };
    tx.create(COLLECTIONS.locationSessions, session);
    return { session, recipientUserId: contact.contactUserId };
  });
  await createNotification({
    recipientUserId,
    type: "location_share",
    title: `${owner.fullName} is sharing their location with you`,
    body: input.mode === "always" ? "Ongoing sharing until they turn it off." : `Temporary sharing for ${input.durationMinutes} minutes.`,
    link: "/location",
  });
  await audit(owner.id, "location.share_started", "locationSession", session.id, { mode: input.mode });
  return session;
}

/** True if the session's trusted-contact link is still ACCEPTED for the same account. */
const linkStillAccepted = (s: Pick<LocationSession, "ownerId" | "contactUserId">, c: TrustedContact | null) =>
  Boolean(c && c.ownerId === s.ownerId && c.status === "accepted" && c.contactUserId && c.contactUserId === s.contactUserId);

/**
 * Pause / resume / stop, in ONE transaction (E5.1). The session is re-read inside it, and a
 * RESUME also re-reads the contact: it is refused unless the relationship is still accepted for
 * the same account. So a resume racing a block can't revive a share for the blocked contact:
 * either the block commits first and the resume sees it, or the resume commits first and the
 * block's clean-up (which runs after the block commits) stops the session.
 */
export async function updateSharing(ownerId: string, id: string, action: "pause" | "resume" | "stop") {
  const store = getStore();
  const updated = await store.runTransaction(async (tx) => {
    const s = await tx.get<LocationSession>(COLLECTIONS.locationSessions, id);
    // Someone else's session answers exactly like a missing one (no existence disclosure).
    if (!s || s.status === "stopped" || s.ownerId !== ownerId) throw notFound("Sharing session not found");
    if (action === "resume") {
      const contact = await tx.get<TrustedContact>(COLLECTIONS.trustedContacts, s.contactId);
      if (!linkStillAccepted(s, contact)) throw badRequest("You can only share with contacts who have accepted your invitation");
    }
    const status = action === "pause" ? "paused" : action === "resume" ? "active" : "stopped";
    // Stopping also wipes the last known position from the shared session.
    const patch: Partial<LocationSession> = { status, updatedAt: nowISO(), ...(action === "stop" ? { lastLocation: null } : {}) };
    tx.update<LocationSession>(COLLECTIONS.locationSessions, id, patch);
    return { ...s, ...patch } as LocationSession;
  });
  await audit(ownerId, `location.share_${action}`, "locationSession", id);
  return updated;
}

/**
 * Owner's device publishes its position to every live session.
 * Each write is CONDITIONAL (E5.1): it re-reads the session and writes only while it is still
 * active and unexpired, so a session stopped meanwhile (by the owner, or by a block/remove) never
 * gets a position written back after its location was wiped.
 */
export async function publishLocation(ownerId: string, location: GeoPoint) {
  const store = getStore();
  const now = new Date();
  const sessions = await store.query<LocationSession>(COLLECTIONS.locationSessions, { where: [where("ownerId", "==", ownerId), where("status", "==", "active")] });
  const live = sessions.filter((s) => isSessionLive(s, now));
  const written = await Promise.all(
    live.map((s) =>
      store.transact<LocationSession>(COLLECTIONS.locationSessions, s.id, (cur) =>
        cur.ownerId === ownerId && isSessionLive(cur, now) ? { lastLocation: location, lastUpdatedAt: location.capturedAt } : null,
      ),
    ),
  );
  return { updatedSessions: written.filter(Boolean).length };
}

/**
 * Sessions shared WITH the caller. Location is withheld unless access is currently valid.
 * Defense in depth (E5.1): each session's trusted-contact link is re-checked; a session whose
 * link is no longer accepted (blocked, removed, left) is not listed at all, even if a race left
 * the session itself active.
 */
export async function listSharedWithMe(viewerId: string) {
  const store = getStore();
  const now = new Date();
  const sessions = await store.query<LocationSession>(COLLECTIONS.locationSessions, { where: [where("contactUserId", "==", viewerId)] });
  const candidates = sessions.filter((s) => s.status !== "stopped");
  const links = await Promise.all(candidates.map((s) => store.get<TrustedContact>(COLLECTIONS.trustedContacts, s.contactId)));
  const valid = candidates.filter((s, i) => linkStillAccepted(s, links[i]) && links[i]!.contactUserId === viewerId);
  return Promise.all(
    valid
      .map(async (s) => {
        const owner = await store.get<UserProfile>(COLLECTIONS.users, s.ownerId);
        const allowed = canViewLocation(s, viewerId, now, { linkActive: true });
        return {
          id: s.id,
          ownerName: owner?.fullName ?? "Unknown",
          mode: s.mode,
          status: effectiveStatus(s, now),
          expiresAt: s.expiresAt,
          location: allowed ? s.lastLocation : null,
          lastUpdatedAt: allowed ? s.lastUpdatedAt : null,
        };
      }),
  );
}
