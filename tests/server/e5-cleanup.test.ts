/**
 * Phase 1 E5: expired-access sweep, retention and resumable account deletion.
 * MemoryStore; all people and events are fictional.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLog, EmergencyEvent, EmergencyResponse, TrustedContact, UserProfile } from "@/core/types";
import { GET as getMe } from "@/app/api/me/route";
import { applyAccessExpiry, applyRetention } from "@/server/services/emergencies";
import { deleteAccount, resumePendingDeletions } from "@/server/services/users";
import { StoreError } from "@/server/store/errors";
import type { MemoryStore } from "@/server/store/memory";
import { COLLECTIONS, where } from "@/server/store/types";
import { freshStore, params, req } from "../support/setup";

let store: MemoryStore;
beforeEach(async () => {
  store = await freshStore();
});
afterEach(() => vi.restoreAllMocks());

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
function closedEvent(id: string, over: Partial<EmergencyEvent> = {}): EmergencyEvent {
  return {
    id, userId: "demo_priya", userName: "Priya Sharma", trigger: "manual", status: "resolved", location: null,
    escalationLevel: 0, escalationConfig: { enabled: true, primaryTimeoutSeconds: 60 }, isSimulated: true,
    authorizedViewerIds: ["demo_anita"], viewerAccessExpiresAt: iso(-3_600_000), viewerAccessOpen: true,
    note: null, createdAt: iso(-86_400_000 * 2), updatedAt: iso(-86_400_000), cancelledAt: null, resolvedAt: iso(-86_400_000), ...over,
  };
}

describe("expired-access sweep", () => {
  it("is not starved by many already-swept events", async () => {
    for (let i = 0; i < 600; i++) {
      await store.create(COLLECTIONS.emergencyEvents, closedEvent(`sos_swept_${String(i).padStart(3, "0")}`, { authorizedViewerIds: [], viewerAccessOpen: false }));
    }
    await store.create(COLLECTIONS.emergencyEvents, closedEvent("sos_needs_sweep"));
    expect((await applyAccessExpiry()).revoked).toBe(1);
    const e = (await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, "sos_needs_sweep"))!;
    expect(e.authorizedViewerIds).toEqual([]);
    expect(e.viewerAccessOpen).toBe(false);
  });

  it("clears more than one page in a run, and a second run does nothing", async () => {
    for (let i = 0; i < 450; i++) await store.create(COLLECTIONS.emergencyEvents, closedEvent(`sos_open_${String(i).padStart(3, "0")}`));
    expect((await applyAccessExpiry()).revoked).toBe(450);
    expect((await applyAccessExpiry()).revoked).toBe(0);
  });

  it("never touches events still inside their window, or active ones", async () => {
    await store.create(COLLECTIONS.emergencyEvents, closedEvent("sos_in_window", { viewerAccessExpiresAt: iso(3_600_000) }));
    await store.create(COLLECTIONS.emergencyEvents, closedEvent("sos_active", { status: "active", viewerAccessExpiresAt: iso(-1000) }));
    await applyAccessExpiry();
    expect((await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, "sos_in_window"))!.authorizedViewerIds).toEqual(["demo_anita"]);
    expect((await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, "sos_active"))!.authorizedViewerIds).toEqual(["demo_anita"]);
  });
});

describe("retention", () => {
  it("deletes an old closed event with all its responses (even > 500), never an active one, and is idempotent", async () => {
    await store.update<UserProfile>(COLLECTIONS.users, "demo_priya", { privacy: { ...(await store.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!.privacy, historyRetentionDays: 30 } });
    const old = iso(-86_400_000 * 90);
    await store.create(COLLECTIONS.emergencyEvents, closedEvent("sos_old", { createdAt: old }));
    await store.create(COLLECTIONS.emergencyEvents, closedEvent("sos_old_active", { createdAt: old, status: "active" }));
    const base = (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, "sos_demo_past__tc_demo_anita"))!;
    for (let i = 0; i < 520; i++) {
      await store.create<EmergencyResponse>(COLLECTIONS.emergencyResponses, { ...base, id: `sos_old__c${i}`, eventId: "sos_old" });
    }
    const batchSpy = vi.spyOn(store, "batch");
    await applyRetention();
    expect(await store.get(COLLECTIONS.emergencyEvents, "sos_old")).toBeNull();
    expect(await store.count(COLLECTIONS.emergencyResponses, { where: [where("eventId", "==", "sos_old")] })).toBe(0);
    expect(await store.get(COLLECTIONS.emergencyEvents, "sos_old_active")).not.toBeNull();
    for (const call of batchSpy.mock.calls) expect(call[0].length).toBeLessThanOrEqual(500); // 500-write limit respected
    expect((await applyRetention()).deleted).toBe(0);
  });
});

describe("resumable account deletion", () => {
  it("an interrupted deletion blocks the account, and the cron job finishes it", async () => {
    // Fail the FIRST batch (Anita's response references), as if the server crashed mid-deletion.
    const real = store.batch.bind(store);
    let failOnce = true;
    vi.spyOn(store, "batch").mockImplementation(async (ops) => {
      if (failOnce) { failOnce = false; throw new StoreError("unavailable", "simulated outage"); }
      return real(ops);
    });

    await expect(deleteAccount("demo_anita")).rejects.toBeInstanceOf(StoreError);
    const pending = (await store.get<UserProfile>(COLLECTIONS.users, "demo_anita"))!;
    expect(pending.deletionPendingAt).toBeTruthy();
    // Already detached from Priya's circle (that step ran before the failure).
    expect((await store.get<TrustedContact>(COLLECTIONS.trustedContacts, "tc_demo_anita"))!.status).toBe("removed");

    // Nothing may act as the account while deletion is pending.
    const me = await getMe(req("GET", "/api/me", { as: "demo_anita" }), params());
    expect(me.status).toBe(403);
    expect((await me.json()).error.message).toMatch(/being deleted/);

    const run = await resumePendingDeletions();
    expect(run).toMatchObject({ pending: 1, completed: 1, failed: 0 });
    expect(await store.get(COLLECTIONS.users, "demo_anita")).toBeNull();
    const past = (await store.get<EmergencyResponse>(COLLECTIONS.emergencyResponses, "sos_demo_past__tc_demo_anita"))!;
    expect(past.contactUserId).toBeNull(); // Priya keeps the record, without the account reference
    expect(past.contactName).toBe("Anita Sharma");
    expect(await store.count(COLLECTIONS.notifications, { where: [where("recipientUserId", "==", "demo_anita")] })).toBe(0);

    // Idempotent: nothing left to do, and a repeated request is harmless.
    expect(await resumePendingDeletions()).toMatchObject({ pending: 0, completed: 0 });
    await expect(deleteAccount("demo_anita")).resolves.toBeUndefined();
    const started = (await store.query<AuditLog>(COLLECTIONS.auditLogs, { where: [where("action", "==", "user.deletion_started")] })).filter((l) => l.actorId === "demo_anita");
    expect(started).toHaveLength(1);
  });

  it("two deletion requests at once both finish cleanly", async () => {
    const results = await Promise.allSettled([deleteAccount("demo_meera"), deleteAccount("demo_meera")]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await store.get(COLLECTIONS.users, "demo_meera")).toBeNull();
    expect((await store.get<TrustedContact>(COLLECTIONS.trustedContacts, "tc_demo_meera"))!.status).toBe("removed");
  });

  it("deleting an SOS owner also removes their SOS lock", async () => {
    const { createEmergency } = await import("@/server/services/emergencies");
    await createEmergency((await store.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!, { trigger: "manual", location: null });
    expect(await store.get(COLLECTIONS.activeEmergencies, "demo_priya")).not.toBeNull();
    await deleteAccount("demo_priya");
    expect(await store.get(COLLECTIONS.activeEmergencies, "demo_priya")).toBeNull();
    expect(await store.count(COLLECTIONS.emergencyEvents, { where: [where("userId", "==", "demo_priya")] })).toBe(0);
  });
});
