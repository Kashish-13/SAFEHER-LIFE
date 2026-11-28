/**
 * Phase 1 E5.1 (audit findings L2, L3): transaction retries can't cause duplicate audit entries,
 * and a concurrent SOS-lock conflict resolves to the REAL existing emergency, while any other
 * database error still ends with the "call 112" fallback, never a false duplicate.
 *
 * MemoryStore runs a transaction callback once, so these tests simulate exactly what Firestore
 * does on contention: re-run the callback after another request changed the data in between.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AuditLog, EmergencyEvent, UserProfile } from "@/core/types";
import { seedDemoData } from "@/server/demo/seed";
import { ApiError } from "@/server/errors";
import { createEmergency } from "@/server/services/emergencies";
import { deleteAccount } from "@/server/services/users";
import { __setStoreForTests } from "@/server/store";
import { StoreError } from "@/server/store/errors";
import { MemoryStore } from "@/server/store/memory";
import { COLLECTIONS, where, type CollectionName, type StoreTransaction } from "@/server/store/types";
import { freshStore } from "../support/setup";

const startedAudits = async (store: MemoryStore, uid: string) =>
  (await store.query<AuditLog>(COLLECTIONS.auditLogs, { where: [where("action", "==", "user.deletion_started")] })).filter((l) => l.actorId === uid);

describe("account deletion under transaction retries (L2)", () => {
  /** Re-runs the users transaction like Firestore would after a concurrent request marked the account. */
  class RetryingStore extends MemoryStore {
    override async transact<T>(collection: CollectionName, id: string, fn: (current: T) => Partial<T> | null): Promise<T | null> {
      if (collection === COLLECTIONS.users && id === "demo_meera") {
        const first = await this.get<T>(collection, id);
        if (first) fn(structuredClone(first)); // attempt 1 sees no deletion in progress...
        // ...then another request marks the account before this one commits, and Firestore retries:
        await super.update<UserProfile>(COLLECTIONS.users, id, { deletionPendingAt: new Date().toISOString() });
      }
      return super.transact(collection, id, fn);
    }
  }

  it("a request that loses the race does not log a second 'deletion_started'", async () => {
    const store = new RetryingStore();
    await seedDemoData(store);
    __setStoreForTests(store);
    await deleteAccount("demo_meera");
    // The concurrent request (simulated by the direct update) owns the "started" entry; this one must not add one.
    expect(await startedAudits(store, "demo_meera")).toHaveLength(0);
    expect(await store.get(COLLECTIONS.users, "demo_meera")).toBeNull(); // deletion still completes
  });

  it("a normal single request logs exactly one 'deletion_started'", async () => {
    const store = await freshStore();
    await deleteAccount("demo_meera");
    expect(await startedAudits(store, "demo_meera")).toHaveLength(1);
  });
});

describe("SOS lock conflicts (L3)", () => {
  class LockRaceStore extends MemoryStore {
    calls = 0;
    mode: "race-once" | "always" | "other-error" = "race-once";
    override async runTransaction<R>(fn: (tx: StoreTransaction) => Promise<R>): Promise<R> {
      this.calls++;
      if (this.mode === "always") throw new StoreError("already_exists", "lock exists (simulated)");
      if (this.mode === "other-error") throw new StoreError("internal", "unexpected backend failure (simulated)");
      if (this.calls === 1) {
        // A concurrent SOS (e.g. a second device) commits the lock + event first...
        await createEmergency((await this.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!, { trigger: "manual", location: null });
        // ...so this request's create of the lock fails at commit.
        throw new StoreError("already_exists", "lock created concurrently (simulated)");
      }
      return super.runTransaction(fn);
    }
  }
  let store: LockRaceStore;
  const active = () => store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents, { where: [where("userId", "==", "demo_priya"), where("status", "==", "active")] });

  beforeEach(async () => {
    store = new LockRaceStore();
    await seedDemoData(store);
    __setStoreForTests(store);
  });

  it("a lock conflict is retried and returns the REAL existing emergency (no second event)", async () => {
    const result = await createEmergency((await store.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!, { trigger: "manual", location: null });
    const events = await active();
    expect(events).toHaveLength(1);
    expect(result.deduplicated).toBe(true);
    expect(result.event.id).toBe(events[0].id);
  });

  it("a conflict that never resolves ends with the 112 fallback, not a fake duplicate", async () => {
    store.mode = "always";
    const err = await createEmergency((await store.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!, { trigger: "manual", location: null }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/Call 112/);
    expect(store.calls).toBe(3); // first try + 2 extra attempts
    expect(await active()).toHaveLength(0);
  });

  it("an unexpected database error is NOT retried as a duplicate and ends with the 112 fallback", async () => {
    store.mode = "other-error";
    const err = await createEmergency((await store.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!, { trigger: "manual", location: null }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/Call 112/);
    expect(store.calls).toBe(1); // not retried
  });
});
