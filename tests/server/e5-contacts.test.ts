/**
 * Phase 1 E5: invitation and contact flows under concurrency (MemoryStore; the key races also run
 * on the Firestore emulator in tests/emulator/services.test.ts). All people are fictional.
 *
 * Invariants checked by every race:
 *  - an invitation is claimed by exactly one account;
 *  - a blocked or removed relationship is never restored by a concurrent approval;
 *  - no location share survives a block.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AppNotification, LocationSession, TrustedContact, UserProfile } from "@/core/types";
import { adminUpdateUser } from "@/server/services/admin";
import { createContact, leaveCircle, respondToInvitation, updateContact } from "@/server/services/contacts";
import { startSharing } from "@/server/services/location";
import type { MemoryStore } from "@/server/store/memory";
import { COLLECTIONS, where } from "@/server/store/types";
import { freshStore } from "../support/setup";

let store: MemoryStore;
const user = async (id: string) => (await store.get<UserProfile>(COLLECTIONS.users, id))!;
const contact = async (id: string) => (await store.get<TrustedContact>(COLLECTIONS.trustedContacts, id))!;
const verified = (u: UserProfile) => ({ emailVerified: true, email: u.email });
const tokenOf = (link: string | null) => link!.split("/invite/")[1];

/** Anita (owner) invites a new contact; returns the contact id and raw token. */
async function anitaInvites(email = "new.contact@example.test") {
  const { contact: c, inviteLink } = await createContact(await user("demo_anita"), { name: "New Contact", relationship: "Friend", priority: "secondary", email, notifyOnEmergency: true }, "http://localhost:3000");
  return { id: c.id, token: tokenOf(inviteLink) };
}
/** Anita's invite claimed by SafeHer Admin (a fictional account outside Anita's circle). */
async function claimedByAdmin() {
  const inv = await anitaInvites();
  const admin = await user("demo_admin");
  await respondToInvitation(admin, verified(admin), inv.token, "accept");
  return inv;
}

beforeEach(async () => {
  store = await freshStore();
});

describe("invitation claims", () => {
  it("two accounts using the same link at once: exactly one claims it", async () => {
    for (let i = 0; i < 5; i++) {
      store = await freshStore();
      const inv = await anitaInvites();
      const [admin, meera] = [await user("demo_admin"), await user("demo_meera")];
      const results = await Promise.allSettled([
        respondToInvitation(admin, verified(admin), inv.token, "accept"),
        respondToInvitation(meera, verified(meera), inv.token, "accept"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect([404, 409]).toContain(loser.reason.status);
      const c = await contact(inv.id);
      expect(c.status).toBe("awaiting_approval");
      expect(c.inviteTokenHash).toBeNull();
      const winner = results[0].status === "fulfilled" ? "demo_admin" : "demo_meera";
      expect(c.claim?.userId).toBe(winner);
      const asks = (await store.query<AppNotification>(COLLECTIONS.notifications, { where: [where("recipientUserId", "==", "demo_anita")] }))
        .filter((n) => n.title.startsWith("Approve "));
      expect(asks).toHaveLength(1); // the owner is asked exactly once
    }
  });

  it("claim vs. resend at once: the state is always consistent", async () => {
    for (let i = 0; i < 5; i++) {
      store = await freshStore();
      const inv = await anitaInvites();
      const admin = await user("demo_admin");
      const [claim, resend] = await Promise.allSettled([
        respondToInvitation(admin, verified(admin), inv.token, "accept"),
        updateContact("demo_anita", inv.id, { action: "resend_invite" }, "http://localhost:3000"),
      ]);
      const c = await contact(inv.id);
      if (claim.status === "fulfilled" && resend.status === "rejected") {
        expect(c.status).toBe("awaiting_approval");
        expect(c.claim?.userId).toBe("demo_admin");
      } else if (resend.status === "fulfilled" && claim.status === "rejected") {
        expect(c.status).toBe("pending");
        expect(c.claim).toBeNull();
        expect(c.inviteTokenHash).not.toBeNull(); // a NEW token; the old one no longer works
      } else {
        // Claim committed first, then a resend was still allowed? It must not be: resend needs pending/declined.
        throw new Error(`unexpected outcome: claim=${claim.status} resend=${resend.status} status=${c.status}`);
      }
    }
  });
});

describe("owner approval can never restore a blocked or removed relationship", () => {
  it("approve after the claimant left → 404 (the link is gone), stays removed", async () => {
    const inv = await claimedByAdmin();
    await leaveCircle("demo_admin", inv.id);
    await expect(updateContact("demo_anita", inv.id, { action: "approve_claim" }, "")).rejects.toMatchObject({ status: 404 });
    expect((await contact(inv.id)).status).toBe("removed");
  });

  it("approve after the owner blocked → 409, stays blocked with no linked account", async () => {
    const inv = await claimedByAdmin();
    await updateContact("demo_anita", inv.id, { action: "block" }, "");
    await expect(updateContact("demo_anita", inv.id, { action: "approve_claim" }, "")).rejects.toMatchObject({ status: 409 });
    const c = await contact(inv.id);
    expect(c.status).toBe("blocked");
    expect(c.contactUserId).toBeNull();
  });

  it("approve vs. leave at the same moment: never ends accepted", async () => {
    for (let i = 0; i < 8; i++) {
      store = await freshStore();
      const inv = await claimedByAdmin();
      await Promise.allSettled([
        updateContact("demo_anita", inv.id, { action: "approve_claim" }, ""),
        leaveCircle("demo_admin", inv.id),
      ]);
      const c = await contact(inv.id);
      expect(c.status).toBe("removed");
      expect(c.contactUserId).toBeNull();
    }
  });

  it("approve vs. block at the same moment: always ends blocked", async () => {
    for (let i = 0; i < 8; i++) {
      store = await freshStore();
      const inv = await claimedByAdmin();
      await Promise.allSettled([
        updateContact("demo_anita", inv.id, { action: "approve_claim" }, ""),
        updateContact("demo_anita", inv.id, { action: "block" }, ""),
      ]);
      expect((await contact(inv.id)).status).toBe("blocked");
    }
  });

  it("approve vs. reject at the same moment: exactly one decision wins", async () => {
    for (let i = 0; i < 5; i++) {
      store = await freshStore();
      const inv = await claimedByAdmin();
      const results = await Promise.allSettled([
        updateContact("demo_anita", inv.id, { action: "approve_claim" }, ""),
        updateContact("demo_anita", inv.id, { action: "reject_claim" }, ""),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(["accepted", "claim_rejected"]).toContain((await contact(inv.id)).status);
    }
  });

  it("approval adds the trusted_contact role to the CURRENT role list", async () => {
    const inv = await claimedByAdmin();
    await updateContact("demo_anita", inv.id, { action: "approve_claim" }, "");
    expect((await user("demo_admin")).roles.sort()).toEqual(["admin", "trusted_contact", "user"]);
  });

  it("an account being deleted can't be approved", async () => {
    const inv = await claimedByAdmin();
    await store.update<UserProfile>(COLLECTIONS.users, "demo_admin", { deletionPendingAt: new Date().toISOString() });
    await expect(updateContact("demo_anita", inv.id, { action: "approve_claim" }, "")).rejects.toMatchObject({ status: 409 });
  });
});

describe("location sharing vs. blocking", () => {
  it("startSharing racing a block never leaves a live share with the blocked contact", async () => {
    for (let i = 0; i < 8; i++) {
      store = await freshStore();
      const priya = await user("demo_priya");
      await Promise.allSettled([
        startSharing(priya, { contactId: "tc_demo_meera", mode: "always" }),
        updateContact("demo_priya", "tc_demo_meera", { action: "block" }, ""),
      ]);
      expect((await contact("tc_demo_meera")).status).toBe("blocked");
      const live = (await store.query<LocationSession>(COLLECTIONS.locationSessions, { where: [where("contactId", "==", "tc_demo_meera")] }))
        .filter((s) => s.status !== "stopped");
      expect(live).toEqual([]);
    }
  });

  it("sharing with an already-blocked contact is refused", async () => {
    await updateContact("demo_priya", "tc_demo_meera", { action: "block" }, "");
    await expect(startSharing(await user("demo_priya"), { contactId: "tc_demo_meera", mode: "always" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("admin user updates", () => {
  it("omitted `disabled` keeps the CURRENT value, not a stale one", async () => {
    await store.update<UserProfile>(COLLECTIONS.users, "demo_meera", { disabled: true });
    const out = await adminUpdateUser("demo_admin", "demo_meera", { roles: ["user", "trusted_contact"] });
    expect(out.disabled).toBe(true);
    await expect(adminUpdateUser("demo_admin", "nobody_here", { roles: ["user"] })).rejects.toMatchObject({ status: 404 });
  });
});
