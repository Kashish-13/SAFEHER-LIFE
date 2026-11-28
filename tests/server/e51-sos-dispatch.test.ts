/**
 * Phase 1 E5.1 (audit finding H1): an SOS that was saved is never reported as an error because an
 * alert failed afterwards; failed alerts stay queued and are retried by the next duplicate SOS
 * request; finalized alerts are never re-sent; concurrent retries never send an alert twice.
 * MemoryStore; all people and events are fictional. Delivery itself is never guaranteed.
 *
 * Failures are injected where they really happen: the store becomes unavailable while a given
 * recipient's alert is being claimed for sending (after the SOS transaction has committed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveEmergencyLock, AppNotification, EmergencyEvent, EmergencyResponse, UserProfile } from "@/core/types";
import { alertNotificationId } from "@/server/services/dispatcher";
import { createEmergency, respondToEmergency, runEscalation } from "@/server/services/emergencies";
import { createNotification } from "@/server/services/notifications";
import { StoreError } from "@/server/store/errors";
import type { MemoryStore } from "@/server/store/memory";
import { COLLECTIONS, where } from "@/server/store/types";
import { freshStore } from "../support/setup";

let store: MemoryStore;
const priya = async () => (await store.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!;
const sos = async () => createEmergency(await priya(), { trigger: "manual", location: null });
const resp = async (eventId: string, contact: string) => (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, `${eventId}__${contact}`))!;
const alerts = async (uid: string, eventId: string) =>
  (await store.query<AppNotification>(COLLECTIONS.notifications, { where: [where("recipientUserId", "==", uid), where("eventId", "==", eventId)] }))
    .filter((n) => n.type === "emergency_alert");
const sentCount = (r: EmergencyResponse) => r.history.filter((h) => h.status === "sent").length;

/** Make claiming the alert for these contacts fail ONCE each (store outage after the SOS commit). */
function failDispatchOnceFor(...contactIds: string[]) {
  const pending = new Set(contactIds);
  const real = store.transact.bind(store);
  vi.spyOn(store, "transact").mockImplementation(async (col, id, fn) => {
    const hit = col === COLLECTIONS.emergencyResponses && [...pending].find((c) => id.endsWith(`__${c}`));
    if (hit) {
      pending.delete(hit);
      throw new StoreError("unavailable", "simulated outage while sending the alert");
    }
    return real(col, id, fn as never);
  });
}

beforeEach(async () => {
  store = await freshStore();
});
afterEach(() => vi.restoreAllMocks());

describe("dispatch failure after the SOS committed", () => {
  it("all recipients failing: the SOS is still saved and returned (not an error); alerts stay queued", async () => {
    failDispatchOnceFor("tc_demo_anita", "tc_demo_rajesh");
    const first = await sos();
    expect(first.deduplicated).toBe(false);
    expect(first.pendingAlerts).toBe(2);
    expect(first.event.status).toBe("active");
    expect((await store.get<ActiveEmergencyLock>(COLLECTIONS.activeEmergencies, "demo_priya"))?.eventId).toBe(first.event.id);
    expect((await resp(first.event.id, "tc_demo_anita")).status).toBe("queued");
    expect((await resp(first.event.id, "tc_demo_rajesh")).status).toBe("queued");
    expect(await alerts("demo_anita", first.event.id)).toHaveLength(0);

    // The person presses SOS again: same emergency, and the queued alerts are sent now.
    vi.restoreAllMocks();
    const again = await sos();
    expect(again.deduplicated).toBe(true);
    expect(again.event.id).toBe(first.event.id);
    expect(again.pendingAlerts).toBe(0);
    expect((await resp(first.event.id, "tc_demo_anita")).status).toBe("sent");
    expect((await resp(first.event.id, "tc_demo_rajesh")).status).toBe("sent");
    expect(await alerts("demo_anita", first.event.id)).toHaveLength(1);
    expect(await alerts("demo_rajesh", first.event.id)).toHaveLength(1);
  });

  it("one recipient failing doesn't stop the others; the retry sends only the missing one", async () => {
    failDispatchOnceFor("tc_demo_anita");
    const first = await sos();
    expect(first.pendingAlerts).toBe(1);
    expect((await resp(first.event.id, "tc_demo_rajesh")).status).toBe("sent");
    expect(await alerts("demo_rajesh", first.event.id)).toHaveLength(1);
    expect((await resp(first.event.id, "tc_demo_anita")).status).toBe("queued");

    vi.restoreAllMocks();
    await sos();
    expect(await alerts("demo_anita", first.event.id)).toHaveLength(1);
    expect(await alerts("demo_rajesh", first.event.id)).toHaveLength(1); // not re-sent
    expect(sentCount(await resp(first.event.id, "tc_demo_rajesh"))).toBe(1);
  });
});

describe("duplicate SOS retries never re-send finalized alerts", () => {
  it("delivered / acknowledged / failed alerts are left alone", async () => {
    const first = await sos();
    const anita = { uid: "demo_anita", roles: ["user", "trusted_contact"] } as never;
    await respondToEmergency(anita, first.event.id, "acknowledge");
    await store.update<EmergencyResponse>(COLLECTIONS.emergencyResponses, `${first.event.id}__tc_demo_rajesh`, { status: "failed", failureReason: "test" });
    const before = [await resp(first.event.id, "tc_demo_anita"), await resp(first.event.id, "tc_demo_rajesh")];
    for (let i = 0; i < 3; i++) expect((await sos()).deduplicated).toBe(true);
    expect(await resp(first.event.id, "tc_demo_anita")).toEqual(before[0]);
    expect(await resp(first.event.id, "tc_demo_rajesh")).toEqual(before[1]);
    expect(await alerts("demo_anita", first.event.id)).toHaveLength(1);
    expect(await alerts("demo_rajesh", first.event.id)).toHaveLength(1);
  });
});

describe("concurrent duplicate retries", () => {
  it("5 duplicate requests at once send each queued alert exactly once", async () => {
    failDispatchOnceFor("tc_demo_anita", "tc_demo_rajesh");
    const first = await sos();
    vi.restoreAllMocks();
    const results = await Promise.all(Array.from({ length: 5 }, () => sos()));
    expect(results.every((r) => r.deduplicated && r.event.id === first.event.id)).toBe(true);
    for (const c of ["tc_demo_anita", "tc_demo_rajesh"]) {
      const r = await resp(first.event.id, c);
      expect(r.status).toBe("sent");
      expect(sentCount(r)).toBe(1);
    }
    expect(await alerts("demo_anita", first.event.id)).toHaveLength(1);
    expect(await alerts("demo_rajesh", first.event.id)).toHaveLength(1);
  });

  it("a live lease (another request is sending) is respected; an expired one is retried", async () => {
    failDispatchOnceFor("tc_demo_anita", "tc_demo_rajesh");
    const first = await sos();
    vi.restoreAllMocks();
    const rid = `${first.event.id}__tc_demo_anita`;
    await store.update<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid, { dispatchLeaseUntil: new Date(Date.now() + 20_000).toISOString() });
    await sos();
    expect((await resp(first.event.id, "tc_demo_anita")).status).toBe("queued"); // someone else holds it
    expect((await resp(first.event.id, "tc_demo_rajesh")).status).toBe("sent");
    await store.update<EmergencyResponse>(COLLECTIONS.emergencyResponses, rid, { dispatchLeaseUntil: new Date(Date.now() - 1000).toISOString() });
    await sos();
    expect((await resp(first.event.id, "tc_demo_anita")).status).toBe("sent");
    expect(await alerts("demo_anita", first.event.id)).toHaveLength(1);
  });

  it("a sender that crashed after writing the inbox alert doesn't cause a second inbox alert", async () => {
    failDispatchOnceFor("tc_demo_anita");
    const first = await sos();
    vi.restoreAllMocks();
    const rid = `${first.event.id}__tc_demo_anita`;
    // The earlier attempt got as far as the inbox write, then died before recording "sent".
    await createNotification({ id: alertNotificationId(rid), recipientUserId: "demo_anita", type: "emergency_alert", title: "Emergency alert", body: "x", eventId: first.event.id });
    await sos();
    expect((await resp(first.event.id, "tc_demo_anita")).status).toBe("sent");
    expect(await alerts("demo_anita", first.event.id)).toHaveLength(1);
  });
});

describe("escalation", () => {
  it("a failed secondary alert doesn't stop escalation or the owner's notice, and is retried later", async () => {
    const first = await sos();
    failDispatchOnceFor("tc_demo_meera");
    const r = await runEscalation(first.event.id, new Date(Date.now() + 10 * 60_000));
    expect(r.escalated).toBe(true);
    expect((await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, first.event.id))!.escalationLevel).toBe(1);
    const ownerNotes = await store.query<AppNotification>(COLLECTIONS.notifications, { where: [where("recipientUserId", "==", "demo_priya"), where("eventId", "==", first.event.id)] });
    expect(ownerNotes.some((n) => n.title === "Your alert was escalated")).toBe(true);
    expect((await resp(first.event.id, "tc_demo_meera")).status).toBe("queued");
    vi.restoreAllMocks();
    await sos(); // duplicate SOS request retries the queued secondary alert
    expect((await resp(first.event.id, "tc_demo_meera")).status).toBe("sent");
    expect(await alerts("demo_meera", first.event.id)).toHaveLength(1);
  });
});
