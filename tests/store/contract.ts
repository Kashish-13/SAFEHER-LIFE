/**
 * DataStore contract (Phase 1 E4), shared by MemoryStore (tests/store/memory-store.test.ts)
 * and FirestoreStore against the LOCAL emulator (tests/emulator/firestore-store.test.ts).
 * Every rule documented in src/server/store/types.ts is checked here against both stores.
 *
 * All data is fictional test data. Result ORDER is only asserted for explicit `orderBy`
 * on distinct values; everything else is compared as a set (see types.ts "Order").
 */
import { beforeEach, describe, expect, it } from "vitest";
import { StoreError, type StoreErrorCode } from "@/server/store/errors";
import type { DataStore, StoreTransaction } from "@/server/store/types";

type Doc = { id: string } & Record<string, unknown>;
const C = "notifications" as const; // any collection name works; the store is generic
const C2 = "auditLogs" as const;

async function expectStoreError(p: Promise<unknown> | (() => unknown), code: StoreErrorCode) {
  let err: unknown;
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    err = e;
  }
  expect(err, `expected StoreError("${code}")`).toBeInstanceOf(StoreError);
  expect((err as StoreError).code).toBe(code);
}

const ids = (docs: { id: string }[]) => docs.map((d) => d.id).sort();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function defineStoreContract(name: string, makeStore: () => Promise<DataStore>) {
  describe(`DataStore contract: ${name}`, () => {
    let store: DataStore;
    beforeEach(async () => {
      store = await makeStore();
    });

    // ── Basic operations ────────────────────────────────────────────────
    describe("create / get / update / delete", () => {
      it("round-trips plain JSON data exactly", async () => {
        const doc: Doc = {
          id: "d1", s: "Priya ✓ नमस्ते", n: 42.5, zero: 0, t: true, f: false, nil: null,
          nested: { a: 1, deep: { b: "x" } }, list: ["a", "b"], objs: [{ k: 1 }, { k: 2 }], empty: [], emptyObj: {},
        };
        expect(await store.create(C, doc)).toEqual(doc);
        expect(await store.get(C, "d1")).toEqual(doc);
      });

      it("get of a missing document returns null", async () => {
        expect(await store.get(C, "missing")).toBeNull();
      });

      it("drops undefined properties (top level and nested)", async () => {
        await store.create(C, { id: "u1", keep: 1, gone: undefined, nested: { keep: 2, gone: undefined } });
        const got = (await store.get<Doc>(C, "u1"))!;
        expect(got).toEqual({ id: "u1", keep: 1, nested: { keep: 2 } });
        expect("gone" in got).toBe(false);
      });

      it("create of an existing id → already_exists, original unchanged", async () => {
        await store.create(C, { id: "dup", v: 1 });
        await expectStoreError(store.create(C, { id: "dup", v: 2 }), "already_exists");
        expect(await store.get(C, "dup")).toEqual({ id: "dup", v: 1 });
      });

      it("update returns exactly the saved document", async () => {
        await store.create(C, { id: "up", a: 1, b: 2, nested: { x: 1, y: 2 } });
        const returned = await store.update<Doc>(C, "up", { b: 3, c: 4, nested: { x: 9 } });
        // A nested object REPLACES the stored one (shallow merge at the top level).
        expect(returned).toEqual({ id: "up", a: 1, b: 3, c: 4, nested: { x: 9 } });
        expect(await store.get(C, "up")).toEqual(returned);
      });

      it("update ignores undefined values (field kept)", async () => {
        await store.create(C, { id: "uu", a: 1, b: 2 });
        expect(await store.update<Doc>(C, "uu", { a: undefined, b: 5 })).toEqual({ id: "uu", a: 1, b: 5 });
      });

      it("update with an empty patch returns the document unchanged", async () => {
        await store.create(C, { id: "ue", a: 1 });
        expect(await store.update<Doc>(C, "ue", {})).toEqual({ id: "ue", a: 1 });
      });

      it("update of a missing document → not_found, nothing created", async () => {
        await expectStoreError(store.update(C, "nope", { a: 1 }), "not_found");
        expect(await store.get(C, "nope")).toBeNull();
      });

      it("delete removes; deleting a missing document is not an error", async () => {
        await store.create(C, { id: "del" });
        await store.delete(C, "del");
        expect(await store.get(C, "del")).toBeNull();
        await expect(store.delete(C, "del")).resolves.toBeUndefined();
      });
    });

    // ── Validation: rejected identically, nothing written ──────────────
    describe("validation", () => {
      const badIds = ["", "a/b", "emergencyEvents/x/y", ".", "..", "__x__", "x".repeat(1501)];

      it("rejects unsafe document ids on every operation", async () => {
        for (const bad of badIds) {
          await expectStoreError(store.get(C, bad), "invalid_argument");
          await expectStoreError(store.create(C, { id: bad }), "invalid_argument");
          await expectStoreError(store.update(C, bad, { a: 1 }), "invalid_argument");
          await expectStoreError(store.delete(C, bad), "invalid_argument");
        }
      });

      it("rejects non-JSON data and writes nothing", async () => {
        class Thing { v = 1; }
        const bad: Record<string, unknown>[] = [
          { when: new Date() }, { obj: new Thing() }, { grid: [[1, 2]] }, { n: Number.NaN }, { n: Infinity },
          { __name__: "x" }, { nested: { __x__: 1 } }, { list: [1, undefined] }, { "": 1 }, { fn: () => 1 },
        ];
        for (const [i, extra] of bad.entries()) {
          await expectStoreError(store.create(C, { id: `bad${i}`, ...extra }), "invalid_argument");
          expect(await store.get(C, `bad${i}`)).toBeNull();
        }
      });

      it("rejects dotted patch keys and id changes, leaving the document unchanged", async () => {
        await store.create(C, { id: "p", nested: { a: 1 } });
        await expectStoreError(store.update(C, "p", { "nested.a": 2 } as Record<string, unknown>), "invalid_argument");
        await expectStoreError(store.update(C, "p", { id: "other" }), "invalid_argument");
        await expectStoreError(store.update(C, "p", { when: new Date() }), "invalid_argument");
        expect(await store.get(C, "p")).toEqual({ id: "p", nested: { a: 1 } });
      });

      it("rejects invalid filters and limits", async () => {
        const many = Array.from({ length: 31 }, (_, i) => `v${i}`);
        await expectStoreError(store.query(C, { where: [{ field: "s", op: "in", value: many }] }), "invalid_argument");
        await expectStoreError(store.query(C, { where: [{ field: "s", op: "in", value: [] }] }), "invalid_argument");
        await expectStoreError(store.query(C, { where: [{ field: "o", op: "==", value: { a: 1 } }] }), "invalid_argument");
        await expectStoreError(store.query(C, { where: [{ field: "s", op: "==", value: undefined }] }), "invalid_argument");
        await expectStoreError(store.query(C, { limit: 0 }), "invalid_argument");
        await expectStoreError(store.count(C, { where: [{ field: "s", op: "in", value: many }] }), "invalid_argument");
      });
    });

    // ── Queries ─────────────────────────────────────────────────────────
    describe("queries", () => {
      beforeEach(async () => {
        const rows: Doc[] = [
          { id: "q1", owner: "a", status: "active", at: "2026-11-01T10:00:00.000Z", n: 1, tags: ["x", "y"], claim: { userId: "u1" }, opt: null },
          { id: "q2", owner: "a", status: "closed", at: "2026-11-02T10:00:00.000Z", n: 2, tags: ["y"], claim: { userId: "u2" } },
          { id: "q3", owner: "b", status: "active", at: "2026-11-03T10:00:00.000Z", n: 3, tags: [], claim: null, opt: "set" },
          { id: "q4", owner: "b", status: "pending", at: 20261104, n: 4, tags: ["x"] }, // `at` is a NUMBER here
        ];
        for (const r of rows) await store.create(C, r);
      });

      it("== on strings, combined filters, nested fields", async () => {
        expect(ids(await store.query(C, { where: [{ field: "owner", op: "==", value: "a" }] }))).toEqual(["q1", "q2"]);
        expect(ids(await store.query(C, { where: [{ field: "owner", op: "==", value: "b" }, { field: "status", op: "==", value: "active" }] }))).toEqual(["q3"]);
        expect(ids(await store.query(C, { where: [{ field: "claim.userId", op: "==", value: "u2" }] }))).toEqual(["q2"]);
      });

      it("== null matches only stored nulls, never missing fields", async () => {
        expect(ids(await store.query(C, { where: [{ field: "opt", op: "==", value: null }] }))).toEqual(["q1"]);
      });

      it("array-contains and in", async () => {
        expect(ids(await store.query(C, { where: [{ field: "tags", op: "array-contains", value: "x" }] }))).toEqual(["q1", "q4"]);
        expect(ids(await store.query(C, { where: [{ field: "status", op: "in", value: ["closed", "pending"] }] }))).toEqual(["q2", "q4"]);
      });

      it("range filters on ISO strings, inclusive and exclusive bounds", async () => {
        const w = (op: "<" | "<=" | ">" | ">=") => ({ where: [{ field: "at", op, value: "2026-11-02T10:00:00.000Z" }] });
        expect(ids(await store.query(C, w("<")))).toEqual(["q1"]);
        expect(ids(await store.query(C, w("<=")))).toEqual(["q1", "q2"]);
        expect(ids(await store.query(C, w(">")))).toEqual(["q3"]); // q4's numeric `at` never matches a string bound
        expect(ids(await store.query(C, w(">=")))).toEqual(["q2", "q3"]);
      });

      it("range filters skip documents that lack the field", async () => {
        await store.create(C, { id: "q5", owner: "c" });
        expect(ids(await store.query(C, { where: [{ field: "n", op: ">=", value: 0 }] }))).toEqual(["q1", "q2", "q3", "q4"]);
      });

      it("!= skips documents where the field is missing or null", async () => {
        // q1 has opt: null, q2/q4 lack opt, q3 has opt: "set".
        expect(ids(await store.query(C, { where: [{ field: "opt", op: "!=", value: "other" }] }))).toEqual(["q3"]);
        expect(ids(await store.query(C, { where: [{ field: "opt", op: "!=", value: "set" }] }))).toEqual([]);
        expect(ids(await store.query(C, { where: [{ field: "status", op: "!=", value: "active" }] }))).toEqual(["q2", "q4"]);
      });

      it("orderBy on distinct values, both directions, with limit", async () => {
        const asc = await store.query<Doc>(C, { where: [{ field: "owner", op: "in", value: ["a", "b"] }], orderBy: { field: "n", direction: "asc" } });
        expect(asc.map((d) => d.id)).toEqual(["q1", "q2", "q3", "q4"]);
        const top2 = await store.query<Doc>(C, { orderBy: { field: "n", direction: "desc" }, limit: 2 });
        expect(top2.map((d) => d.id)).toEqual(["q4", "q3"]);
      });

      it("orderBy excludes documents that lack the sort field, ascending and descending", async () => {
        // q1–q4 have `n`; these two don't. "nullN" stores null, which is kept (position not guaranteed).
        await store.create(C, { id: "noN", owner: "c" });
        await store.create(C, { id: "nestedOnly", owner: "c", meta: {} });
        const asc = await store.query<Doc>(C, { orderBy: { field: "n", direction: "asc" } });
        expect(asc.map((d) => d.id)).toEqual(["q1", "q2", "q3", "q4"]);
        const desc = await store.query<Doc>(C, { orderBy: { field: "n", direction: "desc" } });
        expect(desc.map((d) => d.id)).toEqual(["q4", "q3", "q2", "q1"]);
        // With a limit, missing-field documents never take a slot.
        expect((await store.query<Doc>(C, { orderBy: { field: "n", direction: "asc" }, limit: 2 })).map((d) => d.id)).toEqual(["q1", "q2"]);
        // Nested sort fields: only documents that have the nested value.
        expect((await store.query<Doc>(C, { orderBy: { field: "claim.userId", direction: "desc" } })).map((d) => d.id)).toEqual(["q2", "q1"]);
        // A stored null is kept.
        await store.create(C, { id: "nullN", owner: "c", n: null });
        expect(ids(await store.query<Doc>(C, { orderBy: { field: "n", direction: "asc" } }))).toEqual(["nullN", "q1", "q2", "q3", "q4"]);
        // Combined with a filter, and count is unaffected (no orderBy).
        expect((await store.query<Doc>(C, { where: [{ field: "owner", op: "==", value: "c" }], orderBy: { field: "n", direction: "desc" } })).map((d) => d.id)).toEqual(["nullN"]);
        expect(await store.count(C, { where: [{ field: "owner", op: "==", value: "c" }] })).toBe(3);
      });

      it("limit without orderBy returns that many matching documents", async () => {
        const two = await store.query<Doc>(C, { where: [{ field: "owner", op: "in", value: ["a", "b"] }], limit: 2 });
        expect(two).toHaveLength(2);
        for (const d of two) expect(["a", "b"]).toContain(d.owner);
      });

      it("count agrees with query", async () => {
        expect(await store.count(C)).toBe(4);
        expect(await store.count(C, { where: [{ field: "status", op: "==", value: "active" }] })).toBe(2);
        expect(await store.count(C, { where: [{ field: "owner", op: "==", value: "zzz" }] })).toBe(0);
      });

      it("collections are independent", async () => {
        expect(await store.count(C2)).toBe(0);
      });
    });

    // ── transact (single document) ──────────────────────────────────────
    describe("transact", () => {
      it("returns null for a missing document and creates nothing", async () => {
        expect(await store.transact(C, "none", () => ({ a: 1 }))).toBeNull();
        expect(await store.get(C, "none")).toBeNull();
      });

      it("null from fn aborts without writing; an empty patch changes nothing", async () => {
        await store.create(C, { id: "t", v: 1 });
        expect(await store.transact(C, "t", () => null)).toBeNull();
        expect(await store.transact<Doc>(C, "t", () => ({}))).toEqual({ id: "t", v: 1 });
        expect(await store.get(C, "t")).toEqual({ id: "t", v: 1 });
      });

      it("returns the saved document and validates the patch", async () => {
        await store.create(C, { id: "t2", v: 1 });
        expect(await store.transact<Doc>(C, "t2", (cur) => ({ v: (cur.v as number) + 1 }))).toEqual({ id: "t2", v: 2 });
        await expectStoreError(store.transact(C, "t2", () => ({ when: new Date() })), "invalid_argument");
        expect(await store.get(C, "t2")).toEqual({ id: "t2", v: 2 });
      });

      it("concurrent increments never lose an update", async () => {
        await store.create(C, { id: "ctr", v: 0 });
        const results = await Promise.allSettled(
          Array.from({ length: 10 }, () => store.transact<Doc>(C, "ctr", (cur) => ({ v: (cur.v as number) + 1 }))),
        );
        const ok = results.filter((r) => r.status === "fulfilled").length;
        for (const r of results) if (r.status === "rejected") expect((r.reason as StoreError).code).toBe("aborted");
        expect(ok).toBeGreaterThan(0);
        expect(((await store.get<Doc>(C, "ctr"))!).v).toBe(ok); // every successful increment is kept
      });
    });

    // ── runTransaction (multi-document) ─────────────────────────────────
    describe("runTransaction", () => {
      it("applies writes to several documents together and returns fn's result", async () => {
        await store.create(C, { id: "acct", status: "pending" });
        const result = await store.runTransaction(async (tx) => {
          const a = await tx.get<Doc>(C, "acct");
          const existing = await tx.query<Doc>(C2, { where: [{ field: "ref", op: "==", value: "acct" }] });
          tx.update(C, "acct", { status: "approved", seen: a?.status });
          tx.create(C2, { id: "log1", ref: "acct", before: existing.length });
          tx.delete(C, "nothing-here");
          return "done";
        });
        expect(result).toBe("done");
        expect(await store.get(C, "acct")).toEqual({ id: "acct", status: "approved", seen: "pending" });
        expect(await store.get(C2, "log1")).toEqual({ id: "log1", ref: "acct", before: 0 });
      });

      it("rejects a read after a write and writes nothing", async () => {
        await store.create(C, { id: "rw", v: 1 });
        await expectStoreError(
          store.runTransaction(async (tx) => {
            tx.update(C, "rw", { v: 2 });
            await tx.get(C, "rw");
          }),
          "invalid_argument",
        );
        expect(await store.get(C, "rw")).toEqual({ id: "rw", v: 1 });
      });

      it("an error thrown by fn propagates unchanged and nothing is written", async () => {
        class ServiceError extends Error {}
        await store.create(C, { id: "boom", v: 1 });
        const err = await store
          .runTransaction(async (tx) => {
            await tx.get(C, "boom");
            tx.update(C, "boom", { v: 2 });
            tx.create(C2, { id: "boom-log" });
            throw new ServiceError("caller failure");
          })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ServiceError);
        expect(err).not.toBeInstanceOf(StoreError);
        expect(await store.get(C, "boom")).toEqual({ id: "boom", v: 1 });
        expect(await store.get(C2, "boom-log")).toBeNull();
      });

      it("update of a missing document fails the whole transaction (not_found)", async () => {
        await expectStoreError(
          store.runTransaction(async (tx) => {
            tx.create(C, { id: "partial" });
            tx.update(C, "ghost", { v: 1 });
          }),
          "not_found",
        );
        expect(await store.get(C, "partial")).toBeNull();
      });

      it("create of an existing document fails the whole transaction (already_exists)", async () => {
        await store.create(C, { id: "taken", v: 1 });
        await store.create(C, { id: "other", v: 1 });
        await expectStoreError(
          store.runTransaction(async (tx) => {
            tx.update(C, "other", { v: 2 });
            tx.create(C, { id: "taken", v: 3 });
          }),
          "already_exists",
        );
        expect(await store.get(C, "taken")).toEqual({ id: "taken", v: 1 });
        expect(await store.get(C, "other")).toEqual({ id: "other", v: 1 });
      });

      it("a create after another write to the same document is invalid; repeated updates apply in order", async () => {
        await store.create(C, { id: "same", v: 1 });
        await expectStoreError(
          store.runTransaction(async (tx) => {
            tx.update(C, "same", { v: 2 });
            tx.create(C, { id: "same", v: 3 });
          }),
          "invalid_argument",
        );
        expect(await store.get(C, "same")).toEqual({ id: "same", v: 1 });
        await store.runTransaction(async (tx) => {
          tx.update(C, "same", { v: 2 });
          tx.update(C, "same", { v: 3 });
        });
        expect(await store.get(C, "same")).toEqual({ id: "same", v: 3 });
        await store.batch([
          { type: "update", collection: C, id: "same", patch: { v: 4 } },
          { type: "update", collection: C, id: "same", patch: { v: 5 } },
        ]);
        expect(await store.get(C, "same")).toEqual({ id: "same", v: 5 });
      });

      it("allows at most 500 writes, and writes nothing when exceeded", async () => {
        await expectStoreError(
          store.runTransaction(async (tx) => {
            for (let i = 0; i < 501; i++) tx.create(C2, { id: `w${i}` });
          }),
          "invalid_argument",
        );
        expect(await store.count(C2)).toBe(0);
      });

      it("validates writes inside the transaction", async () => {
        await expectStoreError(store.runTransaction(async (tx) => tx.create(C, { id: "a/b" })), "invalid_argument");
        await expectStoreError(store.runTransaction(async (tx) => tx.update(C, "x", { when: new Date() })), "invalid_argument");
      });

      it("an empty patch inside a transaction is a no-op", async () => {
        await store.runTransaction(async (tx) => tx.update(C, "does-not-exist", {}));
        expect(await store.get(C, "does-not-exist")).toBeNull();
      });

      it("two concurrent claims of the same invitation: exactly one wins", async () => {
        await store.create(C, { id: "invite", status: "pending", claimedBy: null });
        const claim = (who: string) =>
          store.runTransaction(async (tx: StoreTransaction) => {
            const cur = await tx.get<Doc>(C, "invite");
            await sleep(40); // widen the race window: the other claim runs meanwhile
            if (!cur || cur.status !== "pending") return false;
            tx.update(C, "invite", { status: "awaiting_approval", claimedBy: who });
            return true;
          });
        const [a, b] = await Promise.all([claim("alice"), claim("bob")]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
        const final = (await store.get<Doc>(C, "invite"))!;
        expect(final.status).toBe("awaiting_approval");
        expect(final.claimedBy).toBe(a ? "alice" : "bob");
      });
    });

    // ── batch ───────────────────────────────────────────────────────────
    describe("batch", () => {
      it("applies creates, updates and deletes together", async () => {
        await store.create(C, { id: "b1", v: 1 });
        await store.create(C, { id: "b2", v: 1 });
        await store.batch([
          { type: "create", collection: C, doc: { id: "b3", v: 3 } },
          { type: "update", collection: C, id: "b1", patch: { v: 10 } },
          { type: "delete", collection: C, id: "b2" },
          { type: "update", collection: C, id: "b1", patch: {} }, // empty patch: no-op
        ]);
        expect(ids(await store.query(C))).toEqual(["b1", "b3"]);
        expect(await store.get(C, "b1")).toEqual({ id: "b1", v: 10 });
      });

      it("is all-or-nothing when one write fails", async () => {
        await store.create(C, { id: "keep", v: 1 });
        await expectStoreError(
          store.batch([
            { type: "update", collection: C, id: "keep", patch: { v: 2 } },
            { type: "create", collection: C, doc: { id: "new" } },
            { type: "update", collection: C, id: "missing", patch: { v: 1 } },
          ]),
          "not_found",
        );
        expect(await store.get(C, "keep")).toEqual({ id: "keep", v: 1 });
        expect(await store.get(C, "new")).toBeNull();
      });

      it("rejects invalid writes and more than 500 writes before writing anything", async () => {
        await expectStoreError(
          store.batch([{ type: "create", collection: C, doc: { id: "ok" } }, { type: "create", collection: C, doc: { id: "bad/id" } }]),
          "invalid_argument",
        );
        expect(await store.get(C, "ok")).toBeNull();
        const many = Array.from({ length: 501 }, (_, i) => ({ type: "create" as const, collection: C2, doc: { id: `m${i}` } }));
        await expectStoreError(store.batch(many), "invalid_argument");
        expect(await store.count(C2)).toBe(0);
      });
    });
  });
}
