/**
 * Phase 1 E6 (audit L1, L5).
 * L1: acting on someone else's circle, contact, journey, location share or notification gets the
 *     SAME 404 as a record that doesn't exist, so ids can't be probed for existence.
 * L5: newest-first lists break timestamp ties by id, so both stores give the same order.
 * MemoryStore; all data fictional.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AppNotification, AuditLog, EmergencyEvent, JourneySession, UserProfile } from "@/core/types";
import { adminAuditLogs, adminEmergencyActivity } from "@/server/services/admin";
import { updateCircle } from "@/server/services/circles";
import { updateContact } from "@/server/services/contacts";
import { listEmergencyHistory } from "@/server/services/emergencies";
import { listJourneys, updateJourney } from "@/server/services/journeys";
import { updateSharing } from "@/server/services/location";
import { listNotifications, markNotificationRead } from "@/server/services/notifications";
import type { MemoryStore } from "@/server/store/memory";
import { COLLECTIONS } from "@/server/store/types";
import { freshStore } from "../support/setup";

let store: MemoryStore;
beforeEach(async () => {
  store = await freshStore();
});

/** A complete, fictional JourneySession matching the real type. */
const journey = (id: string, userId: string, status: JourneySession["status"], at: string): JourneySession => ({
  id, userId, origin: "Office", destination: "Home", expectedArrivalAt: at, checkInIntervalMinutes: 15, gracePeriodMinutes: 10,
  autoEscalate: false, contactIds: [], status, startedAt: at, lastCheckInAt: at, missedCheckIns: 0, reminderSentForDueAt: null,
  escalatedEventId: null, endedAt: status === "active" ? null : at, createdAt: at, updatedAt: at,
});

/** Runs the call and returns {status, code, message} of the thrown ApiError. */
async function failure(p: Promise<unknown>) {
  const e = (await p.then(() => null, (err) => err)) as { status?: number; code?: string; message?: string } | null;
  expect(e, "expected the call to be refused").not.toBeNull();
  return { status: e!.status, code: e!.code, message: e!.message };
}

describe("L1: someone else's record looks exactly like a missing one", () => {
  it("contacts", async () => {
    const foreign = await failure(updateContact("demo_meera", "tc_demo_anita", { action: "block" }, ""));
    const missing = await failure(updateContact("demo_meera", "tc_does_not_exist", { action: "block" }, ""));
    expect(foreign).toEqual(missing);
    expect(foreign.status).toBe(404);
    expect((await store.get<{ status: string }>(COLLECTIONS.trustedContacts, "tc_demo_anita"))!.status).toBe("accepted");
  });

  it("circles", async () => {
    const input = { name: "Mine now", description: "", contactIds: [] };
    const foreign = await failure(updateCircle("demo_meera", "cir_demo_family", input));
    const missing = await failure(updateCircle("demo_meera", "cir_does_not_exist", input));
    expect(foreign).toEqual(missing);
    expect(foreign.status).toBe(404);
  });

  it("location shares", async () => {
    const foreign = await failure(updateSharing("demo_meera", "loc_demo_anita", "stop"));
    const missing = await failure(updateSharing("demo_meera", "loc_does_not_exist", "stop"));
    expect(foreign).toEqual(missing);
    expect((await store.get<{ status: string }>(COLLECTIONS.locationSessions, "loc_demo_anita"))!.status).toBe("active");
  });

  it("notifications", async () => {
    const foreign = await failure(markNotificationRead("demo_meera", "ntf_demo_rohan_claim"));
    const missing = await failure(markNotificationRead("demo_meera", "ntf_does_not_exist"));
    expect(foreign).toEqual(missing);
    expect((await store.get<AppNotification>(COLLECTIONS.notifications, "ntf_demo_rohan_claim"))!.read).toBe(false);
  });

  it("journeys", async () => {
    await store.create(COLLECTIONS.journeySessions, journey("jny_test_1", "demo_priya", "active", new Date().toISOString()));
    const meera = (await store.get<UserProfile>(COLLECTIONS.users, "demo_meera"))!;
    const foreign = await failure(updateJourney(meera, "jny_test_1", "cancel"));
    const missing = await failure(updateJourney(meera, "jny_does_not_exist", "cancel"));
    expect(foreign).toEqual(missing);
    expect((await store.get<JourneySession>(COLLECTIONS.journeySessions, "jny_test_1"))!.status).toBe("active");
  });
});

describe("L5: equal timestamps are ordered by id (same in every store)", () => {
  const SAME = "2026-11-01T00:00:00.000Z";

  it("notifications", async () => {
    for (const id of ["ntf_tie_c", "ntf_tie_a", "ntf_tie_b"]) {
      await store.create<AppNotification>(COLLECTIONS.notifications, { id, recipientUserId: "demo_meera", type: "emergency_update", title: id, body: "", link: null, eventId: null, read: false, isSimulated: true, createdAt: SAME });
    }
    expect((await listNotifications("demo_meera")).map((n) => n.id)).toEqual(["ntf_tie_a", "ntf_tie_b", "ntf_tie_c"]);
  });

  it("emergency history and admin emergency activity", async () => {
    const base = (await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, "sos_demo_past"))!;
    for (const id of ["sos_tie_2", "sos_tie_1"]) await store.create<EmergencyEvent>(COLLECTIONS.emergencyEvents, { ...base, id, userId: "demo_meera", createdAt: "2099-01-01T00:00:00.000Z" });
    expect((await listEmergencyHistory("demo_meera")).map((e) => e.id)).toEqual(["sos_tie_1", "sos_tie_2"]);
    expect((await adminEmergencyActivity()).slice(0, 2).map((e) => e.id)).toEqual(["sos_tie_1", "sos_tie_2"]);
  });

  it("audit logs", async () => {
    for (const id of ["log_tie_z", "log_tie_y"]) await store.create<AuditLog>(COLLECTIONS.auditLogs, { id, actorId: null, action: "test", targetType: "t", targetId: null, metadata: {}, createdAt: "2099-01-01T00:00:00.000Z" });
    expect((await adminAuditLogs()).slice(0, 2).map((l) => l.id)).toEqual(["log_tie_y", "log_tie_z"]);
  });

  it("journeys", async () => {
    for (const id of ["jny_tie_b", "jny_tie_a"]) await store.create(COLLECTIONS.journeySessions, journey(id, "demo_meera", "arrived", SAME));
    expect((await listJourneys("demo_meera")).map((j) => j.id)).toEqual(["jny_tie_a", "jny_tie_b"]);
  });
});
