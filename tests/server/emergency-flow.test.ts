import { beforeEach, describe, expect, it } from "vitest";
import { POST as createSos } from "@/app/api/emergencies/route";
import { GET as getSos, PATCH as closeSos } from "@/app/api/emergencies/[id]/route";
import { POST as respond } from "@/app/api/emergencies/[id]/respond/route";
import { GET as adminEvents } from "@/app/api/admin/emergencies/route";
import { GET as inbox } from "@/app/api/notifications/route";
import { runEscalation } from "@/server/services/emergencies";
import type { EmergencyResponse } from "@/core/types";
import { freshStore, params, req } from "../support/setup";

const location = { lat: 28.6315, lng: 77.2167, accuracy: 20, capturedAt: new Date().toISOString(), source: "browser" as const };

async function triggerSos(as = "demo_priya") {
  const res = await createSos(req("POST", "/api/emergencies", { as, body: { trigger: "manual", location } }), params());
  expect(res.status).toBe(200);
  return res.json() as Promise<{ event: { id: string; isSimulated: boolean; location: unknown }; responses: EmergencyResponse[]; deduplicated: boolean }>;
}

beforeEach(freshStore);

describe("manual SOS emergency creation", () => {
  it("creates a simulated event and alerts all primary contacts simultaneously", async () => {
    const { event, responses } = await triggerSos();
    expect(event.isSimulated).toBe(true);
    expect(event.location).toMatchObject({ lat: 28.6315 });
    expect(responses.map((r) => r.contactName).sort()).toEqual(["Anita Sharma", "Rajesh Sharma"]);
    // "sent" (inbox write succeeded) — never "delivered" until the recipient's device confirms.
    expect(responses.every((r) => r.status === "sent")).toBe(true);
  });

  it("deduplicates a second SOS while one is active", async () => {
    const first = await triggerSos();
    const second = await triggerSos();
    expect(second.deduplicated).toBe(true);
    expect(second.event.id).toBe(first.event.id);
  });

  it("marks alerts delivered only when the recipient's client fetches them", async () => {
    const { event } = await triggerSos();
    await inbox(req("GET", "/api/notifications", { as: "demo_anita" }), params());
    const owner = await (await getSos(req("GET", `/api/emergencies/${event.id}`, { as: "demo_priya" }), params({ id: event.id }))).json();
    const status = Object.fromEntries(owner.responses.map((r: EmergencyResponse) => [r.contactName, r.status]));
    expect(status).toEqual({ "Anita Sharma": "delivered", "Rajesh Sharma": "sent" });
  });

  it("records acknowledgements from alerted contacts", async () => {
    const { event } = await triggerSos();
    const res = await respond(req("POST", "", { as: "demo_anita", body: { action: "acknowledge" } }), params({ id: event.id }));
    expect((await res.json()).response.status).toBe("acknowledged");
  });
});

describe("emergency access control", () => {
  it("non-alerted users cannot view or respond to an emergency", async () => {
    const { event } = await triggerSos();
    expect((await getSos(req("GET", "", { as: "demo_meera" }), params({ id: event.id }))).status).toBe(403);
    expect((await respond(req("POST", "", { as: "demo_meera", body: { action: "acknowledge" } }), params({ id: event.id }))).status).toBe(403);
  });

  it("only the owner can cancel", async () => {
    const { event } = await triggerSos();
    expect((await closeSos(req("PATCH", "", { as: "demo_anita", body: { action: "cancel" } }), params({ id: event.id }))).status).toBe(403);
    expect((await closeSos(req("PATCH", "", { as: "demo_priya", body: { action: "cancel" } }), params({ id: event.id }))).status).toBe(200);
    // Responding after cancellation is rejected
    expect((await respond(req("POST", "", { as: "demo_anita", body: { action: "acknowledge" } }), params({ id: event.id }))).status).toBe(409);
  });

  it("admin activity view excludes location", async () => {
    await triggerSos();
    const body = await (await adminEvents(req("GET", "", { as: "demo_admin" }), params())).json();
    expect(body.events[0]).not.toHaveProperty("location");
    expect(body.events[0].hasLocation).toBe(true);
  });
});

describe("smart escalation", () => {
  it("alerts secondary contacts once after the timeout when nobody acknowledges", async () => {
    const { event } = await triggerSos();
    const later = new Date(Date.now() + 61_000); // demo Priya's timeout = 60s

    expect((await runEscalation(event.id, new Date())).escalated).toBe(false);
    const [a, b] = await Promise.all([runEscalation(event.id, later), runEscalation(event.id, later)]);
    expect([a.escalated, b.escalated].filter(Boolean)).toHaveLength(1); // concurrent calls → one escalation

    const view = await (await getSos(req("GET", "", { as: "demo_priya" }), params({ id: event.id }))).json();
    const names = view.responses.map((r: EmergencyResponse) => `${r.contactName}:${r.tier}`);
    expect(names).toContain("Meera Iyer:secondary");
    expect(names.filter((n: string) => n.startsWith("Meera"))).toHaveLength(1);
    // Escalated contact can now view the event
    expect((await getSos(req("GET", "", { as: "demo_meera" }), params({ id: event.id }))).status).toBe(200);
  });

  it("does not escalate after a primary acknowledgement", async () => {
    const { event } = await triggerSos();
    await respond(req("POST", "", { as: "demo_rajesh", body: { action: "acknowledge" } }), params({ id: event.id }));
    const r = await runEscalation(event.id, new Date(Date.now() + 600_000));
    expect(r.escalated).toBe(false);
    expect(r.decision.reason).toBe("primary_acknowledged");
  });
});
