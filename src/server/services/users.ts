import { newUserProfile } from "@/core/defaults";
import type { EmergencyEvent, EmergencyPreferences, EmergencyResponse, PrivacySettings, TrustedContact, UserProfile, VoiceSosSettings } from "@/core/types";
import { audit } from "../audit";
import type { AuthContext } from "../auth";
import { isFirebaseAdminConfigured } from "../env";
import { notFound } from "../errors";
import { adminAuth } from "../firebase-admin";
import { nowISO } from "../ids";
import { getStore } from "../store";
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
  if (isFirebaseAdminConfigured()) {
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
  if (isFirebaseAdminConfigured()) await adminAuth().revokeRefreshTokens(uid);
  await getStore().transact<UserProfile>(COLLECTIONS.users, uid, (cur) => ({ tokenVersion: (cur.tokenVersion ?? 0) + 1, updatedAt: nowISO() }));
  await audit(uid, "user.sessions_revoked", "user", uid);
}

/**
 * Permanently deletes the user's account and owned data.
 * - Revokes all sessions first, so no device keeps acting as the user mid-deletion.
 * - Deletes everything the user owns.
 * - Where the user is someone ELSE's contact: the link is detached (owner sees it ended),
 *   their access to that person's emergencies is revoked, and the owner's records of
 *   past alerts keep the name the owner typed but lose the account reference.
 */
export async function deleteAccount(uid: string): Promise<void> {
  const store = getStore();
  await audit(uid, "user.deletion_started", "user", uid);
  if (isFirebaseAdminConfigured()) await adminAuth().revokeRefreshTokens(uid).catch(() => {});

  const owned: [CollectionName, string][] = [
    [COLLECTIONS.trustedContacts, "ownerId"],
    [COLLECTIONS.emergencyCircles, "ownerId"],
    [COLLECTIONS.emergencyEvents, "userId"],
    [COLLECTIONS.emergencyResponses, "ownerId"],
    [COLLECTIONS.locationSessions, "ownerId"],
    [COLLECTIONS.journeySessions, "userId"],
    [COLLECTIONS.notifications, "recipientUserId"],
    [COLLECTIONS.helpers, "userId"],
  ];
  for (const [col, field] of owned) {
    const docs = await store.query<{ id: string }>(col, { where: [where(field, "==", uid)] });
    await Promise.all(docs.map((d) => store.delete(col, d.id)));
  }

  // Links where this user is (or asked to be) someone else's trusted contact.
  const links = await store.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("claim.userId", "==", uid)] });
  await Promise.all(links.map((c) => store.update(COLLECTIONS.trustedContacts, c.id, { contactUserId: null, claim: null, status: "removed", updatedAt: nowISO() })));
  const shares = await store.query<{ id: string }>(COLLECTIONS.locationSessions, { where: [where("contactUserId", "==", uid)] });
  await Promise.all(shares.map((s) => store.update(COLLECTIONS.locationSessions, s.id, { status: "stopped", contactUserId: null, lastLocation: null, updatedAt: nowISO() })));
  const viewing = await store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, { where: [where("authorizedViewerIds", "array-contains", uid)] });
  await Promise.all(viewing.map((e) => store.update(COLLECTIONS.emergencyEvents, e.id, { authorizedViewerIds: e.authorizedViewerIds.filter((x) => x !== uid) })));
  const responses = await store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, { where: [where("contactUserId", "==", uid)] });
  await Promise.all(responses.map((r) => store.update(COLLECTIONS.emergencyResponses, r.id, { contactUserId: null })));

  await store.delete(COLLECTIONS.users, uid);
  if (isFirebaseAdminConfigured()) await adminAuth().deleteUser(uid);
  await audit(uid, "user.deleted", "user", uid);
}
