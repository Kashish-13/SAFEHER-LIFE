/**
 * Phase 1 E5 service races against FirestoreStore on the LOCAL emulator (demo-safeher-life),
 * i.e. with Firestore's real transaction engine instead of MemoryStore. The fictional demo data
 * is loaded into the emulator for each test. Nothing leaves this machine: no push (FCM is never
 * used outside a real Firebase project), no SMS, no email.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveEmergencyLock, AppNotification, EmergencyEvent, EmergencyResponse, LocationSession, TrustedContact, UserProfile } from "@/core/types";
import { seedDemoData } from "@/server/demo/seed";
import { createContact, leaveCircle, respondToInvitation, updateContact } from "@/server/services/contacts";
import { dispatchAlert } from "@/server/services/dispatcher";
import { createEmergency, respondToEmergency, runEscalation } from "@/server/services/emergencies";
import { startSharing } from "@/server/services/location";
import { deleteAccount, resumePendingDeletions } from "@/server/services/users";
import { __setStoreForTests } from "@/server/store";
import { StoreError } from "@/server/store/errors";
import { FirestoreStore } from "@/server/store/firestore";
import { COLLECTIONS, where } from "@/server/store/types";
import { clearEmulator, closeEmulatorApps, emulatorDb } from "./harness";

let store: FirestoreStore;
const user = async (id: string) => (await store.get<UserProfile>(COLLECTIONS.users, id))!;
const contact = async (id: string) => (await store.get<TrustedContact>(COLLECTIONS.trustedContacts, id))!;
const anita = { uid: "demo_anita", roles: ["user", "trusted_contact"] } as never;
const alerts = async (uid: string, eventId: string) =>
  (await store.query<AppNotification>(COLLECTIONS.notifications, { where: [where("recipientUserId", "==", uid), where("eventId", "==", eventId)] }))
    .filter((n) => n.type === "emergency_alert");

beforeEach(async () => {
  vi.stubEnv("SAFEHER_FORCE_DEMO", "true"); // demo semantics (simulated events) over the emulator store
  await clearEmulator();
  store = new FirestoreStore(emulatorDb());
  await seedDemoData(store);
  __setStoreForTests(store);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeEmulatorApps();
});

describe("SOS on Firestore", () => {
  it("5 simultaneous presses → one event, one response and one alert per contact", async () => {
    const priya = await user("demo_priya");
    const results = await Promise.all(Array.from({ length: 5 }, () => createEmergency(priya, { trigger: "manual", location: null })));
    const ids = new Set(results.map((r) => r.event.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
    const [eventId] = ids;
    const active = await store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, { where: [where("userId", "==", "demo_priya"), where("status", "==", "active")] });
    expect(active).toHaveLength(1);
    const rs = await store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, { where: [where("eventId", "==", eventId)] });
    expect(rs.map((r) => r.contactId).sort()).toEqual(["tc_demo_anita", "tc_demo_rajesh"]);
    expect(await alerts("demo_anita", eventId)).toHaveLength(1);
    expect((await store.get<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, "demo_priya"))?.eventId).toBe(eventId);
  });

  it("an acknowledgement racing the dispatcher is never overwritten", async () => {
    const { event } = await createEmergency(await user("demo_priya"), { trigger: "manual", location: null });
    const rid = `${event.id}__tc_demo_anita`;
    await store.update<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid, { status: "queued" });
    const stale = (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid))!;
    await Promise.all([dispatchAlert(event, stale), respondToEmergency(anita, event.id, "acknowledge")]);
    expect((await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid))!.status).toBe("acknowledged");
  });

  it("5 simultaneous escalation checks → secondary contacts alerted exactly once", async () => {
    const { event } = await createEmergency(await user("demo_priya"), { trigger: "manual", location: null });
    const later = new Date(Date.now() + 5 * 60_000);
    const results = await Promise.all(Array.from({ length: 5 }, () => runEscalation(event.id, later)));
    expect(results.filter((r) => r.escalated)).toHaveLength(1);
    const secondary = (await store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, { where: [where("eventId", "==", event.id)] })).filter((r) => r.tier === "secondary");
    expect(secondary.map((r) => r.contactId)).toEqual(["tc_demo_meera"]);
    expect(await alerts("demo_meera", event.id)).toHaveLength(1);
  });
});

describe("contacts on Firestore", () => {
  async function anitaInvites() {
    const { contact: c, inviteLink } = await createContact(await user("demo_anita"), { name: "New Contact", relationship: "Friend", priority: "secondary", email: "new.contact@example.test", notifyOnEmergency: true }, "http://localhost:3200");
    return { id: c.id, token: inviteLink!.split("/invite/")[1] };
  }

  it("two accounts claiming the same invitation at once: exactly one wins", async () => {
    const inv = await anitaInvites();
    const [admin, meera] = [await user("demo_admin"), await user("demo_meera")];
    const results = await Promise.allSettled([
      respondToInvitation(admin, { emailVerified: true, email: admin.email }, inv.token, "accept"),
      respondToInvitation(meera, { emailVerified: true, email: meera.email }, inv.token, "accept"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const c = await contact(inv.id);
    expect(c.status).toBe("awaiting_approval");
    expect(c.inviteTokenHash).toBeNull();
  });

  it("approve vs. leave and approve vs. block never restore the relationship", async () => {
    for (const second of ["leave", "block"] as const) {
      const inv = await anitaInvites();
      const admin = await user("demo_admin");
      await respondToInvitation(admin, { emailVerified: true, email: admin.email }, inv.token, "accept");
      await Promise.allSettled([
        updateContact("demo_anita", inv.id, { action: "approve_claim" }, ""),
        second === "leave" ? leaveCircle("demo_admin", inv.id) : updateContact("demo_anita", inv.id, { action: "block" }, ""),
      ]);
      expect((await contact(inv.id)).status).toBe(second === "leave" ? "removed" : "blocked");
      // Fresh data for the second scenario.
      await clearEmulator();
      await seedDemoData(store);
    }
  });

  it("startSharing racing a block leaves no live share", async () => {
    await Promise.allSettled([
      startSharing(await user("demo_priya"), { contactId: "tc_demo_meera", mode: "always" }),
      updateContact("demo_priya", "tc_demo_meera", { action: "block" }, ""),
    ]);
    expect((await contact("tc_demo_meera")).status).toBe("blocked");
    const live = (await store.query<LocationSession>(COLLECTIONS.locationSessions, { where: [where("contactId", "==", "tc_demo_meera")] })).filter((s) => s.status !== "stopped");
    expect(live).toEqual([]);
  });
});

describe("account deletion on Firestore", () => {
  it("an interrupted deletion is finished by the cron job", async () => {
    const real = store.batch.bind(store);
    let failOnce = true;
    vi.spyOn(store, "batch").mockImplementation(async (ops) => {
      if (failOnce) { failOnce = false; throw new StoreError("unavailable", "simulated outage"); }
      return real(ops);
    });
    await expect(deleteAccount("demo_anita")).rejects.toBeInstanceOf(StoreError);
    expect((await user("demo_anita")).deletionPendingAt).toBeTruthy();
    expect(await resumePendingDeletions()).toMatchObject({ pending: 1, completed: 1, failed: 0 });
    expect(await store.get(COLLECTIONS.users, "demo_anita")).toBeNull();
    expect((await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, "sos_demo_past__tc_demo_anita"))!.contactUserId).toBeNull();
    vi.restoreAllMocks();
  });
});
