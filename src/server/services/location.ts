import { canViewLocation, effectiveStatus, isSessionLive } from "@/core/location-sharing";
import type { GeoPoint, LocationSession, TrustedContact, UserProfile } from "@/core/types";
import { audit } from "../audit";
import { badRequest, forbidden, notFound } from "../errors";
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
  const contact = await store.get<TrustedContact>(COLLECTIONS.trustedContacts, input.contactId);
  if (!contact || contact.ownerId !== owner.id) throw notFound("Contact not found");
  if (contact.status !== "accepted" || !contact.contactUserId) throw badRequest("You can only share with contacts who have accepted your invitation");

  const existing = (await store.query<LocationSession>(COLLECTIONS.locationSessions, { where: [where("ownerId", "==", owner.id), where("contactId", "==", contact.id)] }))
    .find((s) => s.status !== "stopped");
  const now = nowISO();
  const expiresAt = input.mode === "temporary" ? new Date(Date.now() + (input.durationMinutes ?? 60) * 60_000).toISOString() : null;

  let session: LocationSession;
  if (existing) {
    session = await store.update<LocationSession>(COLLECTIONS.locationSessions, existing.id, { mode: input.mode, status: "active", expiresAt, updatedAt: now });
  } else {
    session = {
      id: newId("loc"), ownerId: owner.id, contactId: contact.id, contactUserId: contact.contactUserId, contactName: contact.name,
      mode: input.mode, status: "active", expiresAt, lastLocation: null, lastUpdatedAt: null, createdAt: now, updatedAt: now,
    };
    await store.create(COLLECTIONS.locationSessions, session);
  }
  await createNotification({
    recipientUserId: contact.contactUserId,
    type: "location_share",
    title: `${owner.fullName} is sharing their location with you`,
    body: input.mode === "always" ? "Ongoing sharing until they turn it off." : `Temporary sharing for ${input.durationMinutes} minutes.`,
    link: "/location",
  });
  await audit(owner.id, "location.share_started", "locationSession", session.id, { mode: input.mode });
  return session;
}

export async function updateSharing(ownerId: string, id: string, action: "pause" | "resume" | "stop") {
  const store = getStore();
  const s = await store.get<LocationSession>(COLLECTIONS.locationSessions, id);
  if (!s || s.status === "stopped") throw notFound("Sharing session not found");
  if (s.ownerId !== ownerId) throw forbidden();
  const status = action === "pause" ? "paused" : action === "resume" ? "active" : "stopped";
  // Stopping also wipes the last known position from the shared session.
  const patch: Partial<LocationSession> = { status, updatedAt: nowISO(), ...(action === "stop" ? { lastLocation: null } : {}) };
  const updated = await store.update<LocationSession>(COLLECTIONS.locationSessions, id, patch);
  await audit(ownerId, `location.share_${action}`, "locationSession", id);
  return updated;
}

/** Owner's device publishes its position to every live session. */
export async function publishLocation(ownerId: string, location: GeoPoint) {
  const store = getStore();
  const now = new Date();
  const sessions = await store.query<LocationSession>(COLLECTIONS.locationSessions, { where: [where("ownerId", "==", ownerId), where("status", "==", "active")] });
  const live = sessions.filter((s) => isSessionLive(s, now));
  await Promise.all(live.map((s) => store.update(COLLECTIONS.locationSessions, s.id, { lastLocation: location, lastUpdatedAt: location.capturedAt })));
  return { updatedSessions: live.length };
}

/** Sessions shared WITH the caller. Location is withheld unless access is currently valid. */
export async function listSharedWithMe(viewerId: string) {
  const store = getStore();
  const now = new Date();
  const sessions = await store.query<LocationSession>(COLLECTIONS.locationSessions, { where: [where("contactUserId", "==", viewerId)] });
  return Promise.all(
    sessions
      .filter((s) => s.status !== "stopped")
      .map(async (s) => {
        const owner = await store.get<UserProfile>(COLLECTIONS.users, s.ownerId);
        const allowed = canViewLocation(s, viewerId, now);
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
