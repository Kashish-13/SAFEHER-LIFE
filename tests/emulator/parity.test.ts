/**
 * Differential check: one scripted sequence of store operations is run against MemoryStore
 * and against FirestoreStore (local emulator). Every result, and every error code, must be
 * identical. Unordered query results are compared as sorted id lists (see types.ts "Order").
 * All data is fictional.
 */
import { afterAll, describe, expect, it } from "vitest";
import { StoreError } from "@/server/store/errors";
import { FirestoreStore } from "@/server/store/firestore";
import { MemoryStore } from "@/server/store/memory";
import type { DataStore } from "@/server/store/types";
import { clearEmulator, closeEmulatorApps, emulatorDb } from "./harness";

type Doc = { id: string } & Record<string, unknown>;

/** Runs one step. Query results (`asIds`) become sorted id lists; everything else is compared in full. */
async function outcome(fn: () => Promise<unknown>, asIds = false) {
  try {
    const value = await fn();
    return { ok: asIds ? (value as Doc[]).map((d) => d.id).sort() : (value ?? null) };
  } catch (e) {
    return { error: e instanceof StoreError ? e.code : `non-store: ${(e as Error).name}` };
  }
}

async function scenario(store: DataStore) {
  const log: Record<string, unknown> = {};
  const contacts = "trustedContacts" as const, events = "emergencyEvents" as const;
  log.create1 = await outcome(() => store.create(contacts, { id: "tc1", ownerId: "u1", status: "pending", claim: null, inviteTokenHash: "h1", createdAt: "2026-11-01T00:00:00.000Z" }));
  log.create2 = await outcome(() => store.create(contacts, { id: "tc2", ownerId: "u1", status: "accepted", claim: { userId: "u2" }, contactUserId: "u2", createdAt: "2026-11-02T00:00:00.000Z" }));
  log.dup = await outcome(() => store.create(contacts, { id: "tc1" }));
  log.byToken = await outcome(() => store.query(contacts, { where: [{ field: "inviteTokenHash", op: "==", value: "h1" }], limit: 1 }), true);
  log.byClaim = await outcome(() => store.query(contacts, { where: [{ field: "claim.userId", op: "==", value: "u2" }] }), true);
  log.claim = await outcome(() =>
    store.runTransaction(async (tx) => {
      const [c] = await tx.query<Doc>(contacts, { where: [{ field: "inviteTokenHash", op: "==", value: "h1" }], limit: 1 });
      if (!c || c.status !== "pending") return "lost";
      tx.update(contacts, c.id, { status: "awaiting_approval", claim: { userId: "u3" }, inviteTokenHash: null });
      return "won";
    }),
  );
  log.claimAgain = await outcome(() =>
    store.runTransaction(async (tx) => {
      const found = await tx.query<Doc>(contacts, { where: [{ field: "inviteTokenHash", op: "==", value: "h1" }], limit: 1 });
      return found.length ? "won" : "token consumed";
    }),
  );
  log.afterClaim = await outcome(() => store.get(contacts, "tc1"));
  log.sos = await outcome(() =>
    store.batch([
      { type: "create", collection: events, doc: { id: "ev1", userId: "u1", status: "active", authorizedViewerIds: ["u2"], escalationLevel: 0, createdAt: "2026-11-03T00:00:00.000Z" } },
      { type: "update", collection: contacts, id: "tc2", patch: { updatedAt: "2026-11-03T00:00:00.000Z" } },
    ]),
  );
  log.escalate = await outcome(() => store.transact<Doc>(events, "ev1", (cur) => (cur.escalationLevel === 0 ? { escalationLevel: 1 } : null)));
  log.escalateAgain = await outcome(() => store.transact<Doc>(events, "ev1", (cur) => (cur.escalationLevel === 0 ? { escalationLevel: 1 } : null)));
  log.viewers = await outcome(() => store.query(events, { where: [{ field: "userId", op: "==", value: "u1" }, { field: "authorizedViewerIds", op: "array-contains", value: "u2" }] }), true);
  log.revoke = await outcome(() => store.update<Doc>(events, "ev1", { authorizedViewerIds: [] }));
  log.ordered = await outcome(async () => (await store.query<Doc>(contacts, { orderBy: { field: "createdAt", direction: "desc" } })).map((d) => d.id).join(">"));
  log.counts = await outcome(async () => [await store.count(contacts), await store.count(events, { where: [{ field: "status", op: "==", value: "active" }] })]);
  log.badId = await outcome(() => store.get(events, "ev1/evil/x"));
  log.badData = await outcome(() => store.update(events, "ev1", { when: new Date() }));
  log.missing = await outcome(() => store.update(events, "nope", { status: "x" }));
  log.failedBatch = await outcome(() => store.batch([{ type: "update", collection: events, id: "ev1", patch: { status: "resolved" } }, { type: "delete", collection: contacts, id: "tc1" }, { type: "update", collection: events, id: "ghost", patch: {} }, { type: "update", collection: events, id: "ghost2", patch: { a: 1 } }]));
  log.afterFailedBatch = await outcome(async () => [(await store.get<Doc>(events, "ev1"))?.status, Boolean(await store.get(contacts, "tc1"))]);
  log.final = await outcome(async () => [await store.get(contacts, "tc1"), await store.get(contacts, "tc2"), await store.get(events, "ev1")]);
  return log;
}

describe("MemoryStore and FirestoreStore give identical results", () => {
  it("for the same sequence of operations", async () => {
    const memory = await scenario(new MemoryStore());
    await clearEmulator();
    const firestore = await scenario(new FirestoreStore(emulatorDb()));
    expect(firestore).toEqual(memory);
    // Sanity: the scenario really exercised both success and failure paths.
    expect(memory.claim).toEqual({ ok: "won" });
    expect(memory.claimAgain).toEqual({ ok: "token consumed" });
    expect(memory.escalateAgain).toEqual({ ok: null });
    expect(memory.dup).toEqual({ error: "already_exists" });
    expect(memory.badId).toEqual({ error: "invalid_argument" });
    expect(memory.missing).toEqual({ error: "not_found" });
    expect(memory.failedBatch).toEqual({ error: "not_found" });
    expect(memory.afterFailedBatch).toEqual({ ok: ["active", true] });
  });
});

afterAll(closeEmulatorApps);
