import { describe, expect, it } from "vitest";
import { evaluateEscalation, selectInitialRecipients } from "@/core/escalation";
import type { TrustedContact } from "@/core/types";

const c = (id: string, priority: "primary" | "secondary", status: TrustedContact["status"] = "accepted"): TrustedContact => ({
  id, ownerId: "u", name: id, email: null, phone: null, relationship: "x", priority, status, contactUserId: `user_${id}`,
  inviteTokenHash: null, inviteExpiresAt: null, notifyOnEmergency: true, createdAt: "", updatedAt: "",
});

const contacts = [c("mom", "primary"), c("dad", "primary"), c("friend", "secondary"), c("pending", "secondary", "pending")];
const created = new Date("2026-01-01T10:00:00Z");
const event = { status: "active" as const, escalationLevel: 0, escalationConfig: { enabled: true, primaryTimeoutSeconds: 60 }, createdAt: created.toISOString() };
const primaryResponses = [
  { contactId: "mom", tier: "primary" as const, status: "sent" as const },
  { contactId: "dad", tier: "primary" as const, status: "delivered" as const },
];
const at = (s: number) => new Date(created.getTime() + s * 1000);

describe("emergency escalation", () => {
  it("waits during the timeout window", () => {
    const d = evaluateEscalation(event, primaryResponses, contacts, at(30));
    expect(d).toMatchObject({ shouldEscalate: false, reason: "waiting", secondsRemaining: 30 });
  });

  it("escalates to accepted secondary contacts only after the timeout", () => {
    const d = evaluateEscalation(event, primaryResponses, contacts, at(61));
    expect(d.shouldEscalate).toBe(true);
    expect(d.contactsToNotify.map((x) => x.id)).toEqual(["friend"]); // pending contact excluded
  });

  it("does not escalate if any primary contact acknowledged", () => {
    const rs = [{ ...primaryResponses[0], status: "acknowledged" as const }, primaryResponses[1]];
    expect(evaluateEscalation(event, rs, contacts, at(600)).reason).toBe("primary_acknowledged");
  });

  it("never escalates twice (duplicate notification prevention)", () => {
    expect(evaluateEscalation({ ...event, escalationLevel: 1 }, primaryResponses, contacts, at(600)).reason).toBe("already_escalated");
    const alreadyAlerted = [...primaryResponses, { contactId: "friend", tier: "secondary" as const, status: "sent" as const }];
    expect(evaluateEscalation(event, alreadyAlerted, contacts, at(600)).reason).toBe("no_secondary_contacts");
  });

  it("respects disabled escalation and closed events", () => {
    expect(evaluateEscalation({ ...event, escalationConfig: { enabled: false, primaryTimeoutSeconds: 60 } }, primaryResponses, contacts, at(600)).reason).toBe("disabled");
    expect(evaluateEscalation({ ...event, status: "cancelled" }, primaryResponses, contacts, at(600)).reason).toBe("event_not_active");
  });

  it("alerts everyone eligible when no primary contact exists", () => {
    const { recipients, tier } = selectInitialRecipients([c("a", "secondary"), c("b", "secondary", "blocked")], null);
    expect(tier).toBe("all");
    expect(recipients.map((r) => r.id)).toEqual(["a"]);
  });

  it("limits initial recipients to selected circles", () => {
    const { recipients } = selectInitialRecipients(contacts, ["dad", "friend"]);
    expect(recipients.map((r) => r.id)).toEqual(["dad"]);
  });
});
