import { newUserProfile } from "@/core/defaults";
import type { EmergencyPreferences, PrivacySettings, UserProfile, VoiceSosSettings } from "@/core/types";
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
  const profile = newUserProfile({
    id: auth.uid,
    fullName: input?.fullName || auth.name || "",
    email: auth.email ?? "",
    phone: input?.phone ?? null,
    now: nowISO(),
  });
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
 * Permanently deletes the user's account and owned data. Contact links where
 * this user is someone else's trusted contact are detached (not deleted), so
 * the other person can see the link ended.
 */
export async function deleteAccount(uid: string): Promise<void> {
  const store = getStore();
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
  const linked = await store.query<{ id: string }>(COLLECTIONS.trustedContacts, { where: [where("contactUserId", "==", uid)] });
  await Promise.all(linked.map((c) => store.update(COLLECTIONS.trustedContacts, c.id, { contactUserId: null, status: "removed", updatedAt: nowISO() })));
  const shares = await store.query<{ id: string }>(COLLECTIONS.locationSessions, { where: [where("contactUserId", "==", uid)] });
  await Promise.all(shares.map((s) => store.update(COLLECTIONS.locationSessions, s.id, { status: "stopped", contactUserId: null, updatedAt: nowISO() })));

  await store.delete(COLLECTIONS.users, uid);
  if (isFirebaseAdminConfigured()) await adminAuth().deleteUser(uid);
  await audit(uid, "user.deleted", "user", uid);
}
