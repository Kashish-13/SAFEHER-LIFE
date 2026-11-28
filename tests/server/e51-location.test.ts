/**
 * Phase 1 E5.1 (audit findings M1, M3): location sharing can never be revived for, or shown to,
 * a contact whose relationship is no longer accepted, and a stopped session never gets a
 * position written back. MemoryStore; all people and places are fictional.
 *
 * Where a race can't be forced deterministically, the test reproduces the exact state the race
 * would leave behind (e.g. a contact blocked while its session is still active), so each test
 * fails on the pre-E5.1 code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canViewLocation } from "@/core/location-sharing";
import type { GeoPoint, LocationSession, TrustedContact, UserProfile } from "@/core/types";
import { updateContact } from "@/server/services/contacts";
import { listSharedWithMe, publishLocation, updateSharing } from "@/server/services/location";
import type { MemoryStore } from "@/server/store/memory";
import { COLLECTIONS } from "@/server/store/types";
import { freshStore } from "../support/setup";

let store: MemoryStore;
const session = async (id: string) => (await store.get<LocationSession>(COLLECTIONS.locationSessions, id))!;
const point = (): GeoPoint => ({ lat: 28.6139, lng: 77.209, accuracy: 15, source: "simulated", capturedAt: new Date().toISOString() });

beforeEach(async () => {
  store = await freshStore();
});
afterEach(() => vi.restoreAllMocks());

describe("resuming a share (M1)", () => {
  it("is refused once the contact is blocked, even if the session was not stopped yet", async () => {
    // The state a block leaves for a moment: contact blocked, its paused session not yet stopped.
    await store.update<TrustedContact>(COLLECTIONS.trustedContacts, "tc_demo_rajesh", { status: "blocked" });
    expect((await session("loc_demo_rajesh")).status).toBe("paused");
    await expect(updateSharing("demo_priya", "loc_demo_rajesh", "resume")).rejects.toMatchObject({ status: 400 });
    expect((await session("loc_demo_rajesh")).status).toBe("paused");
  });

  it("is refused for removed contacts and for a link now pointing at a different account", async () => {
    await store.update<TrustedContact>(COLLECTIONS.trustedContacts, "tc_demo_rajesh", { status: "removed" });
    await expect(updateSharing("demo_priya", "loc_demo_rajesh", "resume")).rejects.toMatchObject({ status: 400 });
    await store.update<TrustedContact>(COLLECTIONS.trustedContacts, "tc_demo_rajesh", { status: "accepted", contactUserId: "demo_meera" });
    await expect(updateSharing("demo_priya", "loc_demo_rajesh", "resume")).rejects.toMatchObject({ status: 400 });
  });

  it("resume racing a block never leaves a live share with the blocked contact", async () => {
    for (let i = 0; i < 8; i++) {
      store = await freshStore();
      await Promise.allSettled([
        updateSharing("demo_priya", "loc_demo_rajesh", "resume"),
        updateContact("demo_priya", "tc_demo_rajesh", { action: "block" }, ""),
      ]);
      expect((await store.get<TrustedContact>(COLLECTIONS.trustedContacts, "tc_demo_rajesh"))!.status).toBe("blocked");
      expect((await session("loc_demo_rajesh")).status).not.toBe("active");
      expect(await listSharedWithMe("demo_rajesh")).toEqual([]);
    }
  });

  it("pause and stop still work, and resume works for an accepted contact", async () => {
    await updateSharing("demo_priya", "loc_demo_rajesh", "resume");
    expect((await session("loc_demo_rajesh")).status).toBe("active");
    await updateSharing("demo_priya", "loc_demo_rajesh", "pause");
    expect((await session("loc_demo_rajesh")).status).toBe("paused");
    await updateSharing("demo_priya", "loc_demo_rajesh", "stop");
    const stopped = await session("loc_demo_rajesh");
    expect(stopped.status).toBe("stopped");
    expect(stopped.lastLocation).toBeNull();
    await expect(updateSharing("demo_priya", "loc_demo_rajesh", "resume")).rejects.toMatchObject({ status: 404 });
    await expect(updateSharing("demo_anita", "loc_demo_anita", "pause")).rejects.toMatchObject({ status: 403 });
  });
});

describe("publishing a position (M3)", () => {
  it("never writes a position to a session stopped after it was read", async () => {
    // Reproduce the race window: publishLocation's query still returns the session as ACTIVE,
    // but by the time it writes, the session has been stopped and its location wiped.
    const stale = await session("loc_demo_anita");
    await updateSharing("demo_priya", "loc_demo_anita", "stop");
    vi.spyOn(store, "query").mockResolvedValueOnce([stale] as never);
    const result = await publishLocation("demo_priya", point());
    expect(result.updatedSessions).toBe(0);
    const s = await session("loc_demo_anita");
    expect(s.status).toBe("stopped");
    expect(s.lastLocation).toBeNull();
  });

  it("publish racing stop always ends stopped with no stored position", async () => {
    for (let i = 0; i < 8; i++) {
      store = await freshStore();
      await Promise.all([publishLocation("demo_priya", point()), updateSharing("demo_priya", "loc_demo_anita", "stop")]);
      const s = await session("loc_demo_anita");
      expect(s.status).toBe("stopped");
      expect(s.lastLocation).toBeNull();
    }
  });

  it("still updates live sessions, and skips expired ones", async () => {
    const p = point();
    expect((await publishLocation("demo_priya", p)).updatedSessions).toBe(1); // Anita's (Rajesh's is paused)
    expect((await session("loc_demo_anita")).lastLocation).toEqual(p);
    await store.update<LocationSession>(COLLECTIONS.locationSessions, "loc_demo_anita", { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await publishLocation("demo_priya", point())).updatedSessions).toBe(0);
  });
});

describe("viewing shared locations (defense in depth)", () => {
  it("a blocked contact can't see an old session that a race left active", async () => {
    await store.update<TrustedContact>(COLLECTIONS.trustedContacts, "tc_demo_anita", { status: "blocked" });
    expect((await session("loc_demo_anita")).status).toBe("active"); // the leftover state
    expect(await listSharedWithMe("demo_anita")).toEqual([]);
  });

  it("removed or left links are not listed either", async () => {
    await store.update<TrustedContact>(COLLECTIONS.trustedContacts, "tc_demo_anita", { status: "removed", contactUserId: null });
    expect(await listSharedWithMe("demo_anita")).toEqual([]);
  });

  it("normal sharing: the accepted contact sees the location; paused hides it; expired hides it", async () => {
    const anita = await listSharedWithMe("demo_anita");
    expect(anita).toHaveLength(1);
    expect(anita[0].location).not.toBeNull();
    const rajesh = await listSharedWithMe("demo_rajesh");
    expect(rajesh).toHaveLength(1);
    expect(rajesh[0].location).toBeNull(); // paused
    await store.update<LocationSession>(COLLECTIONS.locationSessions, "loc_demo_anita", { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const expired = await listSharedWithMe("demo_anita");
    expect(expired[0].status).toBe("expired");
    expect(expired[0].location).toBeNull();
  });

  it("canViewLocation denies when the caller knows the link is inactive", () => {
    const s = { status: "active" as const, expiresAt: null, contactUserId: "demo_anita" };
    expect(canViewLocation(s, "demo_anita", new Date())).toBe(true);
    expect(canViewLocation(s, "demo_anita", new Date(), { linkActive: true })).toBe(true);
    expect(canViewLocation(s, "demo_anita", new Date(), { linkActive: false })).toBe(false);
  });
});

describe("unaffected", () => {
  it("other users' sessions are untouched by a publish", async () => {
    const before = await session("loc_demo_rajesh");
    await publishLocation("demo_anita", point()); // Anita owns no sessions
    expect(await session("loc_demo_rajesh")).toEqual(before);
    expect((await store.get<UserProfile>(COLLECTIONS.users, "demo_anita"))).not.toBeNull();
  });
});
