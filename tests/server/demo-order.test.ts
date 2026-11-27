/**
 * Locks the order demo-mode users see TODAY (Phase 1 E4). The store contract leaves the order
 * of equal sort values unspecified, and the demo seed gives every user and contact the SAME
 * createdAt, so any store-ordering change would show up on these screens. If one of these
 * tests fails, a change altered what demo users see: decide that deliberately, don't just
 * update the expectation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { adminListUsers } from "@/server/services/admin";
import { listCircles } from "@/server/services/circles";
import { listContacts } from "@/server/services/contacts";
import { listMySessions } from "@/server/services/location";
import { listNotifications } from "@/server/services/notifications";
import { freshStore } from "../support/setup";

describe("demo-mode ordering is unchanged", () => {
  beforeEach(async () => {
    await freshStore();
  });

  it("Circle page: contacts in the order they were added", async () => {
    expect((await listContacts("demo_priya")).map((c) => c.id)).toEqual([
      "tc_demo_anita", "tc_demo_rajesh", "tc_demo_meera", "tc_demo_kavya", "tc_demo_rohan",
    ]);
  });

  it("Admin users page: seeded users in seed order (all share one createdAt)", async () => {
    expect((await adminListUsers()).map((u) => u.id)).toEqual([
      "demo_priya", "demo_anita", "demo_rajesh", "demo_meera", "demo_admin", "demo_unknown",
    ]);
  });

  it("circles, location sessions and notifications", async () => {
    expect((await listCircles("demo_priya")).map((c) => c.id)).toEqual(["cir_demo_family", "cir_demo_friends"]);
    expect((await listMySessions("demo_priya")).map((s) => s.id)).toEqual(["loc_demo_anita", "loc_demo_rajesh"]);
    expect((await listNotifications("demo_priya")).map((n) => n.id)).toEqual(["ntf_demo_rohan_claim"]);
  });
});
