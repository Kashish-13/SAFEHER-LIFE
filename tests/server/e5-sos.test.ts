/**
 * Phase 1 E5: SOS integrity under concurrency (MemoryStore; the same flows run on the Firestore
 * emulator in tests/emulator/services.test.ts). All people and events are fictional.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActiveEmergencyLock, AppNotification, EmergencyEvent, EmergencyResponse, UserProfile } from "@/core/types";
import { ApiError } from "@/server/errors";
import { dispatchAlert } from "@/server/services/dispatcher";
import { closeEmergency, createEmergency, markDeliveredForRecipient, respondToEmergency, runEscalation } from "@/server/services/emergencies";
import { __setStoreForTests } from "@/server/store";
import { StoreError } from "@/server/store/errors";
import { MemoryStore } from "@/server/store/memory";
import { COLLECTIONS, where, type StoreTransaction } from "@/server/store/types";
import { freshStore } from "../support/setup";

let store: MemoryStore;
const priya = async () => (await store.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!;
const owner = { uid: "demo_priya", roles: ["user"] as const } as never;
const anita = { uid: "demo_anita", roles: ["user", "trusted_contact"] } as never;
const alertsFor = async (uid: string, eventId: string) =>
  (await store.query<AppNotification>(COLLECTIONS.notifications, { where: [where("recipientUserId", "==", uid), where("eventId", "==", eventId)] }))
    .filter((n) => n.type === "emergency_alert");
const activeEvents = async () =>
  store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, { where: [where("userId", "==", "demo_priya"), where("status", "==", "active")] });

/** Runs `fn` outside demo mode (as in emulator/production), restoring the test default after. */
async function outsideDemo<T>(fn: () => Promise<T>) {
  const prevNode = process.env.NODE_ENV;
  process.env.SAFEHER_FORCE_DEMO = "false";
  (process.env as Record<string, string>).NODE_ENV = "production";
  try {
    return await fn();
  } finally {
    process.env.SAFEHER_FORCE_DEMO = "true";
    (process.env as Record<string, string>).NODE_ENV = prevNode ?? "test";
  }
}

beforeEach(async () => {
  store = await freshStore();
});
afterEach(() => {
  process.env.SAFEHER_FORCE_DEMO = "true";
});

describe("duplicate SOS", () => {
  it("5 simultaneous presses → one active event, one response and one alert per contact", async () => {
    const user = await priya();
    const results = await Promise.all(Array.from({ length: 5 }, () => createEmergency(user, { trigger: "manual", location: null })));
    const ids = new Set(results.map((r) => r.event.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
    const [eventId] = ids;
    expect(await activeEvents()).toHaveLength(1);
    const responses = await store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, { where: [where("eventId", "==", eventId)] });
    expect(responses.map((r) => r.contactId).sort()).toEqual(["tc_demo_anita", "tc_demo_rajesh"]);
    expect(await alertsFor("demo_anita", eventId)).toHaveLength(1);
    expect(await alertsFor("demo_rajesh", eventId)).toHaveLength(1);
    const lock = await store.get<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, "demo_priya");
    expect(lock?.eventId).toBe(eventId);
  });

  it("closing releases the lock in the same step; the next SOS is a new event", async () => {
    const user = await priya();
    const first = await createEmergency(user, { trigger: "manual", location: null });
    await closeEmergency(owner, first.event.id, "resolve");
    expect(await store.get(COLLECTIONS.activeEmergencies, "demo_priya")).toBeNull();
    const closed = (await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, first.event.id))!;
    expect(closed.status).toBe("resolved");
    expect(closed.viewerAccessOpen).toBe(true);
    const second = await createEmergency(user, { trigger: "manual", location: null });
    expect(second.deduplicated).toBe(false);
    expect(second.event.id).not.toBe(first.event.id);
    await expect(closeEmergency(owner, first.event.id, "resolve")).rejects.toMatchObject({ status: 409 });
  });

  it("a stale lock (event missing or closed) never blocks a new SOS", async () => {
    const user = await priya();
    await store.create<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, { id: "demo_priya", userId: "demo_priya", eventId: "sos_gone", createdAt: new Date().toISOString() });
    const a = await createEmergency(user, { trigger: "manual", location: null });
    expect(a.deduplicated).toBe(false);
    expect((await store.get<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, "demo_priya"))?.eventId).toBe(a.event.id);
    // Lock pointing at a closed event (e.g. closed by an older code path that didn't release it):
    await store.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, a.event.id, { status: "resolved" });
    const b = await createEmergency(user, { trigger: "manual", location: null });
    expect(b.deduplicated).toBe(false);
    expect((await store.get<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, "demo_priya"))?.eventId).toBe(b.event.id);
  });

  it("an active event from before the lock existed is still de-duplicated (and gets a lock)", async () => {
    const user = await priya();
    const legacy = await createEmergency(user, { trigger: "manual", location: null });
    await store.delete(COLLECTIONS.activeEmergencies, "demo_priya"); // as if created before E5
    const again = await createEmergency(user, { trigger: "manual", location: null });
    expect(again.deduplicated).toBe(true);
    expect(again.event.id).toBe(legacy.event.id);
    expect((await store.get<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, "demo_priya"))?.eventId).toBe(legacy.event.id);
  });

  it("when the SOS can't be recorded safely, the person is told to call 112", async () => {
    let attempts = 0;
    class FailingStore extends MemoryStore {
      override async runTransaction<R>(_fn: (tx: StoreTransaction) => Promise<R>): Promise<R> {
        attempts++;
        throw new StoreError("aborted", "simulated contention");
      }
    }
    const failing = new FailingStore();
    for (const u of await store.query<UserProfile>(COLLECTIONS.users)) await failing.create(COLLECTIONS.users, u);
    __setStoreForTests(failing);
    const err = await createEmergency(await priya(), { trigger: "manual", location: null }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/Call 112/);
    expect(attempts).toBe(3); // first try + 2 extra attempts
  });
});

describe("voice tests never block a real SOS", () => {
  it("outside demo mode a voice test is recorded closed, takes no lock and alerts nobody", async () => {
    await outsideDemo(async () => {
      const user = await priya();
      const test = await createEmergency(user, { trigger: "voice_simulated", location: null });
      expect(test.event.status).toBe("cancelled");
      expect(test.responses).toHaveLength(0);
      expect(await store.get(COLLECTIONS.activeEmergencies, "demo_priya")).toBeNull();
      const real = await createEmergency(user, { trigger: "manual", location: null });
      expect(real.deduplicated).toBe(false);
      expect(real.event.status).toBe("active");
      expect(real.responses.map((r) => r.contactId).sort()).toEqual(["tc_demo_anita", "tc_demo_rajesh"]);
    });
  });

  it("a legacy voice test left ACTIVE (pre-fix data) is closed and does not suppress the real SOS", async () => {
    await outsideDemo(async () => {
      const user = await priya();
      const legacy: EmergencyEvent = {
        id: "sos_legacy_voice", userId: "demo_priya", userName: "Priya Sharma", trigger: "voice_simulated", status: "active",
        location: null, escalationLevel: 0, escalationConfig: { enabled: false, primaryTimeoutSeconds: 60 }, isSimulated: true,
        authorizedViewerIds: [], viewerAccessExpiresAt: null, note: "old dry run", createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), cancelledAt: null, resolvedAt: null,
      };
      await store.create(COLLECTIONS.emergencyEvents, legacy);
      await store.create<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, { id: "demo_priya", userId: "demo_priya", eventId: legacy.id, createdAt: legacy.createdAt });
      const real = await createEmergency(user, { trigger: "manual", location: null });
      expect(real.deduplicated).toBe(false);
      expect(real.event.id).not.toBe(legacy.id);
      expect(real.responses.length).toBeGreaterThan(0);
      expect((await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, legacy.id))?.status).toBe("cancelled");
    });
  });

  it("concurrent voice test + real SOS: the real SOS always alerts contacts", async () => {
    await outsideDemo(async () => {
      const user = await priya();
      const [, real] = await Promise.all([
        createEmergency(user, { trigger: "voice_simulated", location: null }),
        createEmergency(user, { trigger: "manual", location: null }),
      ]);
      expect(real.deduplicated).toBe(false);
      expect(real.responses.length).toBeGreaterThan(0);
    });
  });
});

describe("acknowledgements are never overwritten by alert dispatch", () => {
  it("an acknowledgement made while the alert was still queued survives the dispatcher's save", async () => {
    const user = await priya();
    const { event } = await createEmergency(user, { trigger: "manual", location: null });
    const rid = `${event.id}__tc_demo_anita`;
    // Rewind Anita's response to "queued", as it is between the transaction and dispatch.
    const queued = (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid))!;
    await store.update<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid, { status: "queued", history: [queued.history[0]] });
    const stale = (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid))!;

    await respondToEmergency(anita, event.id, "acknowledge"); // queued → acknowledged (allowed)
    const after = await dispatchAlert(event, stale); // dispatcher still holds the queued copy
    expect(after.status).toBe("acknowledged");
    const final = (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid))!;
    expect(final.status).toBe("acknowledged");
    expect(final.history.map((h) => h.status)).toEqual(["queued", "acknowledged"]);
  });

  it("acknowledging and dispatching at the same moment always ends acknowledged", async () => {
    for (let i = 0; i < 5; i++) {
      store = await freshStore();
      const { event } = await createEmergency(await priya(), { trigger: "manual", location: null });
      const rid = `${event.id}__tc_demo_anita`;
      await store.update<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid, { status: "queued" });
      const stale = (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid))!;
      await Promise.all([dispatchAlert(event, stale), respondToEmergency(anita, event.id, "acknowledge")]);
      expect((await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid))!.status).toBe("acknowledged");
    }
  });

  it("opening a still-queued alert marks it delivered; answering twice differently is a 409, not a 500", async () => {
    const { event } = await createEmergency(await priya(), { trigger: "manual", location: null });
    const rid = `${event.id}__tc_demo_anita`;
    await store.update<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid, { status: "queued" });
    await markDeliveredForRecipient(event.id, "demo_anita");
    expect((await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid))!.status).toBe("delivered");
    await respondToEmergency(anita, event.id, "acknowledge");
    await expect(respondToEmergency(anita, event.id, "decline")).rejects.toMatchObject({ status: 409 });
    expect((await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid))!.status).toBe("acknowledged");
  });
});

describe("escalation", () => {
  it("5 simultaneous escalation checks → secondary contacts alerted exactly once", async () => {
    const { event } = await createEmergency(await priya(), { trigger: "manual", location: null });
    const later = new Date(Date.now() + 5 * 60_000);
    const results = await Promise.all(Array.from({ length: 5 }, () => runEscalation(event.id, later)));
    expect(results.filter((r) => r.escalated)).toHaveLength(1);
    const ev = (await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, event.id))!;
    expect(ev.escalationLevel).toBe(1);
    expect(ev.authorizedViewerIds).toContain("demo_meera");
    const secondary = (await store.query<EmergencyResponse>(COLLECTIONS.emergencyResponses, { where: [where("eventId", "==", event.id)] })).filter((r) => r.tier === "secondary");
    expect(secondary.map((r) => r.contactId)).toEqual(["tc_demo_meera"]);
    expect(await alertsFor("demo_meera", event.id)).toHaveLength(1);
  });
});
