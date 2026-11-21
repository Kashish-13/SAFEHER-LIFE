import { beforeEach, describe, expect, it } from "vitest";
import { GET as listContacts, POST as addContact } from "@/app/api/contacts/route";
import { PATCH as updateContact } from "@/app/api/contacts/[id]/route";
import { POST as respondInvite } from "@/app/api/invitations/respond/route";
import { freshStore, params, req } from "../support/setup";

beforeEach(freshStore);

async function invite(body: Record<string, unknown>) {
  const res = await addContact(req("POST", "/api/contacts", { as: "demo_meera", body }), params());
  return { status: res.status, body: await res.json() };
}
const tokenFrom = (link: string) => link.split("/invite/")[1];

describe("trusted contact invitations", () => {
  it("creates a pending contact and returns a one-time invite link", async () => {
    const { status, body } = await invite({ name: "Priya", relationship: "Friend", email: "priya.demo@safeher.app", priority: "primary" });
    expect(status).toBe(200);
    expect(body.contact.status).toBe("pending");
    expect(body.contact.inviteTokenHash).toBeNull(); // hash never leaves the server
    expect(body.inviteLink).toMatch(/\/invite\/[\w-]{40,}/);
  });

  it("links the account on acceptance and makes the token single-use", async () => {
    const { body } = await invite({ name: "Priya", relationship: "Friend", email: "priya.demo@safeher.app", priority: "primary" });
    const token = tokenFrom(body.inviteLink);
    const accept = await respondInvite(req("POST", "", { as: "demo_priya", body: { token, decision: "accept" } }), params());
    expect((await accept.json()).contact).toMatchObject({ status: "accepted", contactUserId: "demo_priya" });
    const again = await respondInvite(req("POST", "", { as: "demo_anita", body: { token, decision: "accept" } }), params());
    expect(again.status).toBe(404);
  });

  it("records rejection", async () => {
    const { body } = await invite({ name: "Anita", relationship: "Aunt", email: "anita.demo@safeher.app", priority: "secondary" });
    const res = await respondInvite(req("POST", "", { as: "demo_anita", body: { token: tokenFrom(body.inviteLink), decision: "reject" } }), params());
    expect((await res.json()).contact.status).toBe("rejected");
  });

  it("prevents accepting your own invitation and duplicate contacts", async () => {
    const { body } = await invite({ name: "Me", relationship: "Self", phone: "+919811111111", priority: "primary" });
    const self = await respondInvite(req("POST", "", { as: "demo_meera", body: { token: tokenFrom(body.inviteLink), decision: "accept" } }), params());
    expect(self.status).toBe(400);
    expect((await invite({ name: "Dup", relationship: "x", phone: "+919811111111", priority: "primary" })).status).toBe(409);
  });

  it("users can only modify their own contacts", async () => {
    const res = await updateContact(req("PATCH", "", { as: "demo_meera", body: { action: "block" } }), params({ id: "tc_demo_anita" }));
    expect(res.status).toBe(403);
  });

  it("blocked contacts are excluded from emergency alerts", async () => {
    await updateContact(req("PATCH", "", { as: "demo_priya", body: { action: "block" } }), params({ id: "tc_demo_rajesh" }));
    const list = await (await listContacts(req("GET", "", { as: "demo_priya" }), params())).json();
    expect(list.contacts.find((c: { id: string }) => c.id === "tc_demo_rajesh").status).toBe("blocked");
    const { POST: sos } = await import("@/app/api/emergencies/route");
    const res = await (await sos(req("POST", "", { as: "demo_priya", body: { trigger: "manual", location: null } }), params())).json();
    expect(res.responses.map((r: { contactName: string }) => r.contactName)).toEqual(["Anita Sharma"]);
  });
});
