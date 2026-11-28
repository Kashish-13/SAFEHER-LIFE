import { beforeEach, describe, expect, it } from "vitest";
import { POST as addContact } from "@/app/api/contacts/route";
import { PATCH as updateContact } from "@/app/api/contacts/[id]/route";
import { DELETE as leave } from "@/app/api/contacts/incoming/[id]/route";
import { POST as respondInvite } from "@/app/api/invitations/respond/route";
import { POST as createSos } from "@/app/api/emergencies/route";
import { GET as getSos, PATCH as closeSos } from "@/app/api/emergencies/[id]/route";
import { POST as respond } from "@/app/api/emergencies/[id]/respond/route";
import { GET as alerts } from "@/app/api/alerts/route";
import { GET as status } from "@/app/api/status/route";
import { DELETE as deleteMe, GET as me } from "@/app/api/me/route";
import { DELETE as revokeSessions } from "@/app/api/me/sessions/route";
import { applyAccessExpiry } from "@/server/services/emergencies";
import { signDemoToken } from "@/server/demo-token";
import type { AppNotification, EmergencyEvent, TrustedContact, UserProfile } from "@/core/types";
import { COLLECTIONS, where } from "@/server/store/types";
import { freshStore, params, req } from "../support/setup";

let store: Awaited<ReturnType<typeof freshStore>>;
beforeEach(async () => { store = await freshStore(); });

const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const tokenFrom = (link: string) => link.split("/invite/")[1];

async function sos(as = "demo_priya") {
  const r = await json(await createSos(req("POST", "", { as, body: { trigger: "manual", location: null } }), params()));
  expect(r.status).toBe(200);
  return r.body.event as EmergencyEvent;
}
const view = (id: string, as: string) => getSos(req("GET", "", { as }), params({ id }));

/** Meera invites Anita; returns the contact id and the one-time token. */
async function meeraInvitesAnita(email = "anita.demo@safeher.app") {
  const r = await json(await addContact(req("POST", "", { as: "demo_meera", body: { name: "Anita", relationship: "Aunt", email, priority: "primary" } }), params()));
  return { id: r.body.contact.id as string, token: tokenFrom(r.body.inviteLink) };
}

describe("0.3/0.4 invitation identity and owner approval", () => {
  it("records the REAL claimant identity and grants nothing until the owner approves", async () => {
    const { id, token } = await meeraInvitesAnita();
    await respondInvite(req("POST", "", { as: "demo_anita", body: { token, decision: "accept" } }), params());
    const c = (await store.get<TrustedContact>(COLLECTIONS.trustedContacts, id))!;
    expect(c.status).toBe("awaiting_approval");
    expect(c.contactUserId).toBeNull();
    expect(c.claim).toMatchObject({ userId: "demo_anita", displayName: "Anita Sharma", email: "anita.demo@safeher.app", emailVerified: true, matchesInvite: { email: true } });

    // Before approval: Meera's SOS does not alert Anita, and Anita can't see it.
    const ev = await sos("demo_meera");
    expect(ev.authorizedViewerIds).not.toContain("demo_anita");
    expect((await view(ev.id, "demo_anita")).status).toBe(403);
  });

  it("a forwarded link used by a different account is flagged as a mismatch and still needs approval", async () => {
    const { id, token } = await meeraInvitesAnita("someone.else@example.com");
    await respondInvite(req("POST", "", { as: "demo_rajesh", body: { token, decision: "accept" } }), params());
    const c = (await store.get<TrustedContact>(COLLECTIONS.trustedContacts, id))!;
    expect(c.status).toBe("awaiting_approval");
    expect(c.claim?.matchesInvite.email).toBe(false);
    const ownerNote = await store.query<AppNotification>(COLLECTIONS.notifications, { where: [where("recipientUserId", "==", "demo_meera")] });
    expect(ownerNote.some((n) => n.body.includes("don't match"))).toBe(true);
    // The link is consumed: a third person can't claim it too.
    expect((await respondInvite(req("POST", "", { as: "demo_priya", body: { token, decision: "accept" } }), params())).status).toBe(404);
  });

  it("owner approval grants access; the claimant then receives alerts", async () => {
    const { id, token } = await meeraInvitesAnita();
    await respondInvite(req("POST", "", { as: "demo_anita", body: { token, decision: "accept" } }), params());
    const r = await json(await updateContact(req("PATCH", "", { as: "demo_meera", body: { action: "approve_claim" } }), params({ id })));
    expect(r.body.contact).toMatchObject({ status: "accepted", contactUserId: "demo_anita" });
    const ev = await sos("demo_meera");
    expect(ev.authorizedViewerIds).toContain("demo_anita");
    expect((await view(ev.id, "demo_anita")).status).toBe(200);
  });

  it("owner rejection grants nothing; a fresh invitation is required", async () => {
    const { id, token } = await meeraInvitesAnita();
    await respondInvite(req("POST", "", { as: "demo_anita", body: { token, decision: "accept" } }), params());
    await updateContact(req("PATCH", "", { as: "demo_meera", body: { action: "reject_claim" } }), params({ id }));
    const c = (await store.get<TrustedContact>(COLLECTIONS.trustedContacts, id))!;
    expect(c).toMatchObject({ status: "claim_rejected", contactUserId: null });
    const resent = await json(await updateContact(req("PATCH", "", { as: "demo_meera", body: { action: "resend_invite" } }), params({ id })));
    expect(resent.body.contact.status).toBe("pending");
    expect(resent.body.contact.claim).toBeNull();
    expect(resent.body.inviteLink).toMatch(/\/invite\//);
  });

  it("only the owner can approve a claim", async () => {
    // E6 / audit L1: a non-owner gets the same 404 as for a missing contact (was 403); still denied.
    expect((await updateContact(req("PATCH", "", { as: "demo_anita", body: { action: "approve_claim" } }), params({ id: "tc_demo_rohan" }))).status).toBe(404);
  });

  it("claimants must have a verified email or phone", async () => {
    await store.update<UserProfile>(COLLECTIONS.users, "demo_anita", { emailVerified: false, phoneVerified: false });
    const { token } = await meeraInvitesAnita();
    const r = await respondInvite(req("POST", "", { as: "demo_anita", body: { token, decision: "accept" } }), params());
    expect(r.status).toBe(403);
  });

  it("in-app invitations are only delivered to accounts with a VERIFIED email", async () => {
    await store.update<UserProfile>(COLLECTIONS.users, "demo_anita", { emailVerified: false });
    await meeraInvitesAnita();
    const inbox = await store.query<AppNotification>(COLLECTIONS.notifications, { where: [where("recipientUserId", "==", "demo_anita"), where("type", "==", "contact_invitation")] });
    expect(inbox).toHaveLength(0);
  });
});

describe("0.5 emergency access expiry and revocation", () => {
  it("contacts keep access for 24 h after RESOLVE, then lose it", async () => {
    const ev = await sos();
    await closeSos(req("PATCH", "", { as: "demo_priya", body: { action: "resolve" } }), params({ id: ev.id }));
    const closed = (await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, ev.id))!;
    const hours = (new Date(closed.viewerAccessExpiresAt!).getTime() - new Date(closed.resolvedAt!).getTime()) / 3_600_000;
    expect(hours).toBe(24);
    expect((await view(ev.id, "demo_anita")).status).toBe(200);

    await store.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, ev.id, { viewerAccessExpiresAt: new Date(Date.now() - 1000).toISOString() });
    const denied = await json(await view(ev.id, "demo_anita"));
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/24 hours/);
    expect((await view(ev.id, "demo_priya")).status).toBe(200); // owner keeps access
  });

  it("the same 24 h window applies to CANCELLED emergencies", async () => {
    const ev = await sos();
    await closeSos(req("PATCH", "", { as: "demo_priya", body: { action: "cancel" } }), params({ id: ev.id }));
    const closed = (await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, ev.id))!;
    expect(closed.status).toBe("cancelled");
    expect(new Date(closed.viewerAccessExpiresAt!).getTime() - new Date(closed.cancelledAt!).getTime()).toBe(24 * 3_600_000);
  });

  it("the sweep physically removes viewers once the window has passed", async () => {
    const ev = await sos();
    await closeSos(req("PATCH", "", { as: "demo_priya", body: { action: "resolve" } }), params({ id: ev.id }));
    expect((await applyAccessExpiry(new Date())).revoked).toBe(0); // still inside window
    const { revoked } = await applyAccessExpiry(new Date(Date.now() + 25 * 3_600_000));
    expect(revoked).toBe(1);
    expect((await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, ev.id))!.authorizedViewerIds).toEqual([]);
  });

  it("BLOCKING a contact revokes access to an ACTIVE emergency immediately", async () => {
    const ev = await sos();
    expect((await view(ev.id, "demo_anita")).status).toBe(200);
    await updateContact(req("PATCH", "", { as: "demo_priya", body: { action: "block" } }), params({ id: "tc_demo_anita" }));
    expect((await view(ev.id, "demo_anita")).status).toBe(403);
    expect((await respond(req("POST", "", { as: "demo_anita", body: { action: "acknowledge" } }), params({ id: ev.id }))).status).toBe(403);
    expect((await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, ev.id))!.authorizedViewerIds).not.toContain("demo_anita");
    const list = await json(await alerts(req("GET", "", { as: "demo_anita" }), params()));
    expect(list.body.alerts).toHaveLength(0);
  });

  it("REMOVING a contact revokes access immediately, including closed emergencies inside the window", async () => {
    const ev = await sos();
    await closeSos(req("PATCH", "", { as: "demo_priya", body: { action: "resolve" } }), params({ id: ev.id }));
    await updateContact(req("PATCH", "", { as: "demo_priya", body: { action: "remove" } }), params({ id: "tc_demo_rajesh" }));
    expect((await view(ev.id, "demo_rajesh")).status).toBe(403);
    expect((await view(ev.id, "demo_anita")).status).toBe(200); // others unaffected
  });

  it("unblocking does not restore access to past emergencies", async () => {
    const ev = await sos();
    await updateContact(req("PATCH", "", { as: "demo_priya", body: { action: "block" } }), params({ id: "tc_demo_anita" }));
    await updateContact(req("PATCH", "", { as: "demo_priya", body: { action: "unblock" } }), params({ id: "tc_demo_anita" }));
    expect((await view(ev.id, "demo_anita")).status).toBe(403);
  });

  it("a contact who LEAVES the circle loses access immediately", async () => {
    const ev = await sos();
    await leave(req("DELETE", "", { as: "demo_anita" }), params({ id: "tc_demo_anita" }));
    expect((await view(ev.id, "demo_anita")).status).toBe(403);
  });
});

describe("0.6 account deletion and sign-out-everywhere", () => {
  it("deletion requires a sign-in within the last 5 minutes", async () => {
    const stale = signDemoToken("demo_meera", 3600, 0, Math.floor(Date.now() / 1000) - 600);
    const r = await json(await deleteMe(req("DELETE", "", { token: stale, body: { confirm: "DELETE" } }), params()));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("reauth_required");
    expect(await store.get(COLLECTIONS.users, "demo_meera")).not.toBeNull();
  });

  it("deletion with a fresh sign-in removes the account and detaches links", async () => {
    const ev = await sos(); // Meera not alerted (secondary), but Anita is
    const r = await deleteMe(req("DELETE", "", { as: "demo_anita", body: { confirm: "DELETE" } }), params());
    expect(r.status).toBe(200);
    expect(await store.get(COLLECTIONS.users, "demo_anita")).toBeNull();
    const link = (await store.get<TrustedContact>(COLLECTIONS.trustedContacts, "tc_demo_anita"))!;
    expect(link).toMatchObject({ status: "removed", contactUserId: null, claim: null });
    expect((await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, ev.id))!.authorizedViewerIds).not.toContain("demo_anita");
  });

  it("sign-out-everywhere invalidates every existing session token", async () => {
    const tokenA = signDemoToken("demo_priya");
    const tokenB = signDemoToken("demo_priya");
    expect((await me(req("GET", "", { token: tokenB }), params())).status).toBe(200);
    expect((await revokeSessions(req("DELETE", "", { token: tokenA }), params())).status).toBe(200);
    expect((await me(req("GET", "", { token: tokenA }), params())).status).toBe(401);
    expect((await me(req("GET", "", { token: tokenB }), params())).status).toBe(401);
    const fresh = signDemoToken("demo_priya", undefined, 1);
    expect((await me(req("GET", "", { token: fresh }), params())).status).toBe(200);
  });
});

describe("0.9 lightweight status endpoint", () => {
  it("reports pending approvals, active emergency and incoming alerts in one call", async () => {
    const owner = await json(await status(req("GET", "", { as: "demo_priya" }), params()));
    expect(owner.body).toMatchObject({ activeEmergency: null, pendingApprovals: 1, incomingAlerts: [] });
    expect(owner.body.unreadNotifications).toBeGreaterThanOrEqual(1);

    const ev = await sos();
    const contact = await json(await status(req("GET", "", { as: "demo_anita" }), params()));
    expect(contact.body.incomingAlerts.map((a: { eventId: string }) => a.eventId)).toEqual([ev.id]);
    // Shown on the recipient's device → recorded as delivered.
    const owner2 = await json(await view(ev.id, "demo_priya"));
    expect(owner2.body.responses.find((r: { contactName: string }) => r.contactName === "Anita Sharma").status).toBe("delivered");
    expect((await json(await status(req("GET", "", { as: "demo_priya" }), params()))).body.activeEmergency.id).toBe(ev.id);
  });
});
