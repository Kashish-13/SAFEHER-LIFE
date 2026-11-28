import { newUserProfile } from "@/core/defaults";
import type { EmergencyEvent, EmergencyPreferences, EmergencyResponse, LocationSession, PrivacySettings, TrustedContact, UserProfile, VoiceSosSettings } from "@/core/types";
import { audit } from "../audit";
import type { AuthContext } from "../auth";
import { isFirebaseBackend } from "../env";
import { notFound } from "../errors";
import { adminAuth } from "../firebase-admin";
import { nowISO } from "../ids";
import { getStore } from "../store";
import { batchInChunks } from "../store/batching";
import { COLLECTIONS, where, type CollectionName } from "../store/types";

/** Returns the caller's profile, creating it on first sign-in. */
export async function getOrCreateProfile(auth: AuthContext, input?: { fullName?: string; phone?: string | null }): Promise<UserProfile> {
  if (auth.profile) return auth.profile;
  const profile: UserProfile = {
    ...newUserProfile({
      id: auth.uid,
      fullName: input?.fullName || auth.name || "",
      email: auth.email ?? "",
      phone: input?.phone ?? null,
      now: nowISO(),
    }),
    emailVerified: auth.emailVerified,
  };
  await getStore().create(COLLECTIONS.users, profile);
  await audit(auth.uid, "user.created", "user", auth.uid);
  return profile;
}

type ProfilePatch = Partial<Pick<UserProfile, "fullName" | "phone" | "language" | "photoURL" | "onboardingComplete">>;

export async function updateProfile(uid: string, patch: ProfilePatch): Promise<UserProfile> {
  const store = getStore();
  const cur = await store.get<UserProfile>(COLLECTIONS.users, uid);
  if (!cur) throw notFound("Profile not found");
  const next: Partial<UserProfile> = { ...patch, updatedAt: nowISO() };
  // Changing the phone number invalidates its verification.
  if (patch.phone !== undefined && patch.phone !== cur.phone) next.phoneVerified = false;
  return store.update<UserProfile>(COLLECTIONS.users, uid, next);
}

export async function updateSettings(
  uid: string,
  patch: { emergencyPreferences?: EmergencyPreferences; voiceSos?: VoiceSosSettings; privacy?: PrivacySettings },
): Promise<UserProfile> {
  const updated = await getStore().update<UserProfile>(COLLECTIONS.users, uid, { ...patch, updatedAt: nowISO() });
  await audit(uid, "user.settings_updated", "user", uid, { sections: Object.keys(patch) });
  return updated;
}

/** Records that Firebase Auth has verified the user's phone (called after client-side OTP). */
export async function markPhoneVerified(uid: string, phone: string): Promise<UserProfile> {
  if (isFirebaseBackend()) {
    const record = await adminAuth().getUser(uid);
    if (record.phoneNumber !== phone) throw notFound("Phone number is not verified on this account");
  }
  return getStore().update<UserProfile>(COLLECTIONS.users, uid, { phone, phoneVerified: true, updatedAt: nowISO() });
}

export async function registerPushToken(uid: string, token: string): Promise<void> {
  await getStore().transact<UserProfile>(COLLECTIONS.users, uid, (cur) =>
    cur.fcmTokens.includes(token) ? null : { fcmTokens: [...cur.fcmTokens, token].slice(-10) },
  );
}

/**
 * Sign out everywhere: invalidates every existing session on every device.
 * Firebase: revokes refresh tokens; ID tokens are then rejected by verifyIdToken(checkRevoked).
 * Demo: bumps tokenVersion so previously issued demo tokens stop working.
 */
export async function revokeAllSessions(uid: string): Promise<void> {
  if (isFirebaseBackend()) await adminAuth().revokeRefreshTokens(uid);
  await getStore().transact<UserProfile>(COLLECTIONS.users, uid, (cur) => ({ tokenVersion: (cur.tokenVersion ?? 0) + 1, updatedAt: nowISO() }));
  await audit(uid, "user.sessions_revoked", "user", uid);
}

/**
 * Permanently deletes the user's account and owned data. RESUMABLE (Phase 1 E5):
 *
 * 1. A transaction sets `deletionPendingAt`. From then on authentication rejects the account
 *    (like a disabled one), so nothing can act as the user mid-deletion.
 * 2. `completeAccountDeletion` runs every clean-up step. Each step is idempotent (it only touches
 *    documents still referencing the user), so it can be re-run after any failure.
 * 3. The user record is deleted LAST, so an interrupted deletion is always found again by the
 *    cron job (`resumePendingDeletions`), which finishes it.
 */
export async function deleteAccount(uid: string): Promise<void> {
  const store = getStore();
  const now = nowISO();
  let firstRequest = false;
  await store.transact<UserProfile>(COLLECTIONS.users, uid, (cur) => {
    // Reset on EVERY attempt (E5.1, audit L2): Firestore may re-run this callback. If an earlier
    // attempt saw no deletion in progress but a concurrent request marked it before the retry,
    // this request must not also log "deletion_started".
    firstRequest = false;
    if (cur.deletionPendingAt) return null; // already in progress: just resume
    firstRequest = true;
    return { deletionPendingAt: now, updatedAt: now };
  });
  if (firstRequest) await audit(uid, "user.deletion_started", "user", uid);
  await completeAccountDeletion(uid);
}

/** Every step only matches documents that still reference the user, so re-running is safe. */
export async function completeAccountDeletion(uid: string): Promise<void> {
  const store = getStore();
  if (isFirebaseBackend()) await adminAuth().revokeRefreshTokens(uid).catch(() => {});

  // Links where this user is (or asked to be) someone else's trusted contact: detached, each
  // re-checked in a transaction (the owner sees it ended; access is revoked by the status).
  const links = await store.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("claim.userId", "==", uid)] });
  for (const c of links) {
    await store.transact<TrustedContact>(COLLECTIONS.trustedContacts, c.id, (cur) =>
      cur.claim?.userId === uid || cur.contactUserId === uid ? { contactUserId: null, claim: null, status: "removed", updatedAt: nowISO() } : null,
    );
  }
  // Location shared WITH the user stops.
  const shares = await store.query<LocationSession>(COLLECTIONS.locationSessions, { where: [where("contactUserId", "==", uid)] });
  for (const s of shares) {
    await store.transact<LocationSession>(COLLECTIONS.locationSessions, s.id, (cur) =>
      cur.contactUserId === uid ? { status: "stopped", contactUserId: null, lastLocation: null, updatedAt: nowISO() } : null,
    );
  }
  // Removed from other people's emergencies.
  const viewing = await store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, { where: [where("authorizedViewerIds", "array-contains", uid)] });
  for (const e of viewing) {
    await store.transact<EmergencyEvent>(COLLECTIONS.emergencyEvents, e.id, (cur) =>
      cur.authorizedViewerIds.includes(uid) ? { authorizedViewerIds: cur.authorizedViewerIds.filter((x) => x !== uid), updatedAt: nowISO() } : null,
    );
  }
  // Owners' records of past alerts keep the name they typed but lose the account reference.
  const responses = await store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, { where: [where("contactUserId", "==", uid)] });
  await batchInChunks(store, responses.map((r) => ({ type: "update" as const, collection: COLLECTIONS.emergencyResponses, id: r.id, patch: { contactUserId: null } })));

  // Everything the user owns, in atomic chunks of ≤ 500 deletes.
  const owned: [CollectionName, string][] = [
    [COLLECTIONS.trustedContacts, "ownerId"],
    [COLLECTIONS.emergencyCircles, "ownerId"],
    [COLLECTIONS.emergencyResponses, "ownerId"],
    [COLLECTIONS.emergencyEvents, "userId"],
    [COLLECTIONS.activeEmergencies, "userId"],
    [COLLECTIONS.locationSessions, "ownerId"],
    [COLLECTIONS.journeySessions, "userId"],
    [COLLECTIONS.notifications, "recipientUserId"],
    [COLLECTIONS.helpers, "userId"],
  ];
  for (const [col, field] of owned) {
    const docs = await store.query<{ id: string }>(col, { where: [where(field, "==", uid)] });
    await batchInChunks(store, docs.map((d) => ({ type: "delete" as const, collection: col, id: d.id })));
  }

  // The sign-in account, then the user record LAST (it is what makes the deletion resumable).
  if (isFirebaseBackend()) {
    await adminAuth().deleteUser(uid).catch((err: { code?: string }) => {
      if (err?.code !== "auth/user-not-found") throw err; // already gone: fine on a resumed run
    });
  }
  await store.delete(COLLECTIONS.users, uid);
  await audit(uid, "user.deleted", "user", uid);
}

/** Cron: finishes deletions that were interrupted (bounded per run; the next run continues). */
export async function resumePendingDeletions(limit = 20) {
  const store = getStore();
  const pending = await store.query<UserProfile>(COLLECTIONS.users, { where: [where("deletionPendingAt", "!=", null)], limit });
  let completed = 0;
  const failed: string[] = [];
  for (const u of pending) {
    try {
      await completeAccountDeletion(u.id);
      completed++;
    } catch (err) {
      console.error("[deletion] resume failed", u.id, err);
      failed.push(u.id);
    }
  }
  return { pending: pending.length, completed, failed: failed.length };
}
