/**
 * Phase 1 E5: list order no longer depends on how a store breaks ties. Records sharing a
 * timestamp are ordered by id, the same in MemoryStore and Firestore. The demo order itself is
 * guarded, unchanged, by tests/server/demo-order.test.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { EmergencyCircle, TrustedContact, UserProfile } from "@/core/types";
import { adminListUsers } from "@/server/services/admin";
import { listCircles } from "@/server/services/circles";
import { listContacts } from "@/server/services/contacts";
import type { MemoryStore } from "@/server/store/memory";
import { COLLECTIONS } from "@/server/store/types";
import { freshStore } from "../support/setup";

let store: MemoryStore;
beforeEach(async () => {
  store = await freshStore();
});

const SAME = "2026-11-01T00:00:00.000Z";

describe("ties are broken by id, not by store insertion order", () => {
  it("contacts with the same createdAt", async () => {
    const base = (await store.get<TrustedContact>(COLLECTIONS.trustedContacts, "tc_demo_meera"))!;
    // Inserted in REVERSE id order on purpose.
    for (const id of ["tc_tie_c", "tc_tie_b", "tc_tie_a"]) {
      await store.create<TrustedContact>(COLLECTIONS.trustedContacts, { ...base, id, ownerId: "demo_meera", createdAt: SAME, email: `${id}@example.test` });
    }
    expect((await listContacts("demo_meera")).map((c) => c.id)).toEqual(["tc_tie_a", "tc_tie_b", "tc_tie_c"]);
  });

  it("circles with the same createdAt", async () => {
    for (const id of ["cir_tie_z", "cir_tie_y"]) {
      await store.create<EmergencyCircle>(COLLECTIONS.emergencyCircles, { id, ownerId: "demo_meera", name: id, description: "", contactIds: [], createdAt: SAME, updatedAt: SAME });
    }
    expect((await listCircles("demo_meera")).map((c) => c.id)).toEqual(["cir_tie_y", "cir_tie_z"]);
  });

  it("admin users with the same createdAt (newest first, then id)", async () => {
    const future = "2099-01-01T00:00:00.000Z";
    const base = (await store.get<UserProfile>(COLLECTIONS.users, "demo_meera"))!;
    for (const id of ["u_tie_2", "u_tie_1"]) await store.create<UserProfile>(COLLECTIONS.users, { ...base, id, email: `${id}@example.test`, createdAt: future });
    expect((await adminListUsers()).slice(0, 2).map((u) => u.id)).toEqual(["u_tie_1", "u_tie_2"]);
  });

  it("seeded demo records now have distinct timestamps (no ties left to break)", async () => {
    const contacts = await store.query<TrustedContact>(COLLECTIONS.trustedContacts);
    const users = await store.query<UserProfile>(COLLECTIONS.users);
    expect(new Set(contacts.map((c) => c.createdAt)).size).toBe(contacts.length);
    expect(new Set(users.map((u) => u.createdAt)).size).toBe(users.length);
  });
});
