import { DEFAULT_EMERGENCY_PREFERENCES, newUserProfile } from "@/core/defaults";
import type { EmergencyCircle, EmergencyEvent, EmergencyResponse, LocationSession, TrustedContact, UserProfile } from "@/core/types";
import { COLLECTIONS, type DataStore } from "../store/types";

/**
 * DEMO MODE seed data. Every person here is fictional and every event is
 * flagged `isSimulated`. No real alerts are ever sent in demo mode.
 */
export const DEMO_PERSONAS = [
  { id: "demo_priya", fullName: "Priya Sharma", email: "priya.demo@safeher.app", role: "Primary user", description: "Has a configured emergency circle, journeys and history." },
  { id: "demo_anita", fullName: "Anita Sharma", email: "anita.demo@safeher.app", role: "Trusted contact (Mother)", description: "Receives Priya's alerts. Use to acknowledge an SOS." },
  { id: "demo_meera", fullName: "Meera Iyer", email: "meera.demo@safeher.app", role: "Trusted contact (Best friend)", description: "Secondary contact — alerted on escalation." },
  { id: "demo_admin", fullName: "SafeHer Admin", email: "admin.demo@safeher.app", role: "Administrator", description: "Platform admin with redacted emergency views." },
] as const;

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
// Connaught Place, New Delhi — fictional demo coordinates.
const DEMO_POINT = { lat: 28.6315, lng: 77.2167, accuracy: 25, source: "simulated" as const };

export async function seedDemoData(store: DataStore) {
  if (await store.get(COLLECTIONS.users, "demo_priya")) return;
  const t = ago(60 * 24 * 14);

  const users: UserProfile[] = [
    {
      ...newUserProfile({ id: "demo_priya", fullName: "Priya Sharma", email: "priya.demo@safeher.app", phone: "+919800000001", now: t }),
      phoneVerified: true,
      onboardingComplete: true,
      emergencyPreferences: { ...DEFAULT_EMERGENCY_PREFERENCES, escalation: { enabled: true, primaryTimeoutSeconds: 60 } },
    },
    { ...newUserProfile({ id: "demo_anita", fullName: "Anita Sharma", email: "anita.demo@safeher.app", phone: "+919800000002", now: t }), roles: ["user", "trusted_contact"], onboardingComplete: true },
    { ...newUserProfile({ id: "demo_rajesh", fullName: "Rajesh Sharma", email: "rajesh.demo@safeher.app", phone: "+919800000003", now: t }), roles: ["user", "trusted_contact"], onboardingComplete: true },
    { ...newUserProfile({ id: "demo_meera", fullName: "Meera Iyer", email: "meera.demo@safeher.app", phone: "+919800000004", now: t }), roles: ["user", "trusted_contact"], onboardingComplete: true },
    { ...newUserProfile({ id: "demo_admin", fullName: "SafeHer Admin", email: "admin.demo@safeher.app", now: t }), roles: ["user", "admin"], onboardingComplete: true },
  ];

  const contact = (id: string, name: string, relationship: string, priority: "primary" | "secondary", userId: string | null, status: TrustedContact["status"] = "accepted"): TrustedContact => ({
    id, ownerId: "demo_priya", name, relationship, priority, status, contactUserId: userId,
    email: userId ? `${userId.replace("demo_", "")}.demo@safeher.app` : "kavya.demo@example.com",
    phone: null, inviteTokenHash: null, inviteExpiresAt: status === "pending" ? new Date(Date.now() + 5 * 86_400_000).toISOString() : null,
    notifyOnEmergency: true, createdAt: t, updatedAt: t,
  });
  const contacts = [
    contact("tc_demo_anita", "Anita Sharma", "Mother", "primary", "demo_anita"),
    contact("tc_demo_rajesh", "Rajesh Sharma", "Father", "primary", "demo_rajesh"),
    contact("tc_demo_meera", "Meera Iyer", "Best friend", "secondary", "demo_meera"),
    contact("tc_demo_kavya", "Kavya Reddy", "Roommate", "secondary", null, "pending"),
  ];

  const circles: EmergencyCircle[] = [
    { id: "cir_demo_family", ownerId: "demo_priya", name: "Family", description: "Parents — always alerted first", contactIds: ["tc_demo_anita", "tc_demo_rajesh"], createdAt: t, updatedAt: t },
    { id: "cir_demo_friends", ownerId: "demo_priya", name: "Friends", description: "Close friends nearby", contactIds: ["tc_demo_meera", "tc_demo_kavya"], createdAt: t, updatedAt: t },
  ];

  const pastEvent: EmergencyEvent = {
    id: "sos_demo_past", userId: "demo_priya", userName: "Priya Sharma", trigger: "manual", status: "resolved",
    location: { ...DEMO_POINT, capturedAt: ago(60 * 24 * 3) }, escalationLevel: 0,
    escalationConfig: { enabled: true, primaryTimeoutSeconds: 60 }, isSimulated: true,
    authorizedViewerIds: ["demo_anita", "demo_rajesh"], note: "Felt followed near the metro exit. Mother called within a minute.",
    createdAt: ago(60 * 24 * 3), updatedAt: ago(60 * 24 * 3 - 18), cancelledAt: null, resolvedAt: ago(60 * 24 * 3 - 18),
  };
  const pastResponse = (cid: string, name: string, uid: string, final: "acknowledged" | "delivered"): EmergencyResponse => ({
    id: `${pastEvent.id}__${cid}`, eventId: pastEvent.id, ownerId: "demo_priya", contactId: cid, contactUserId: uid, contactName: name,
    tier: "primary", channels: ["in_app", "push"], status: final,
    history: [
      { status: "queued", at: pastEvent.createdAt },
      { status: "sent", at: pastEvent.createdAt, detail: "Via in-app inbox" },
      { status: "delivered", at: ago(60 * 24 * 3 - 1), detail: "Opened on recipient's device" },
      ...(final === "acknowledged" ? [{ status: "acknowledged" as const, at: ago(60 * 24 * 3 - 1) }] : []),
    ],
    failureReason: null, createdAt: pastEvent.createdAt, updatedAt: pastEvent.updatedAt,
  });

  const sessions: LocationSession[] = [
    { id: "loc_demo_anita", ownerId: "demo_priya", contactId: "tc_demo_anita", contactUserId: "demo_anita", contactName: "Anita Sharma", mode: "always", status: "active", expiresAt: null, lastLocation: { ...DEMO_POINT, capturedAt: ago(4) }, lastUpdatedAt: ago(4), createdAt: t, updatedAt: t },
    { id: "loc_demo_rajesh", ownerId: "demo_priya", contactId: "tc_demo_rajesh", contactUserId: "demo_rajesh", contactName: "Rajesh Sharma", mode: "always", status: "paused", expiresAt: null, lastLocation: null, lastUpdatedAt: null, createdAt: t, updatedAt: t },
  ];

  for (const u of users) await store.create(COLLECTIONS.users, u);
  for (const c of contacts) await store.create(COLLECTIONS.trustedContacts, c);
  for (const c of circles) await store.create(COLLECTIONS.emergencyCircles, c);
  await store.create(COLLECTIONS.emergencyEvents, pastEvent);
  await store.create(COLLECTIONS.emergencyResponses, pastResponse("tc_demo_anita", "Anita Sharma", "demo_anita", "acknowledged"));
  await store.create(COLLECTIONS.emergencyResponses, pastResponse("tc_demo_rajesh", "Rajesh Sharma", "demo_rajesh", "delivered"));
  for (const s of sessions) await store.create(COLLECTIONS.locationSessions, s);
}
