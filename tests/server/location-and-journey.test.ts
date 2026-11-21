import { beforeEach, describe, expect, it } from "vitest";
import { POST as startShare } from "@/app/api/location/sessions/route";
import { PATCH as updateShare } from "@/app/api/location/sessions/[id]/route";
import { POST as publish } from "@/app/api/location/update/route";
import { GET as sharedWithMe } from "@/app/api/location/shared-with-me/route";
import { POST as startJourney } from "@/app/api/journeys/route";
import { PATCH as updateJourney } from "@/app/api/journeys/[id]/route";
import { processJourney } from "@/server/services/journeys";
import type { AppNotification, EmergencyEvent } from "@/core/types";
import { COLLECTIONS, where } from "@/server/store/types";
import { freshStore, params, req } from "../support/setup";

const loc = () => ({ lat: 28.61, lng: 77.2, accuracy: 15, capturedAt: new Date().toISOString(), source: "browser" as const });
let store: Awaited<ReturnType<typeof freshStore>>;
beforeEach(async () => { store = await freshStore(); });

describe("family location sharing permissions", () => {
  it("only accepted contacts can be shared with", async () => {
    const res = await startShare(req("POST", "", { as: "demo_priya", body: { contactId: "tc_demo_kavya", mode: "always" } }), params());
    expect(res.status).toBe(400);
  });

  it("viewer sees location only while the session is active", async () => {
    await publish(req("POST", "", { as: "demo_priya", body: { location: loc() } }), params());
    const view = async () => (await (await sharedWithMe(req("GET", "", { as: "demo_anita" }), params())).json()).shared[0];
    expect((await view()).location).toMatchObject({ lat: 28.61 });

    await updateShare(req("PATCH", "", { as: "demo_priya", body: { action: "pause" } }), params({ id: "loc_demo_anita" }));
    expect((await view()).location).toBeNull();

    await updateShare(req("PATCH", "", { as: "demo_priya", body: { action: "stop" } }), params({ id: "loc_demo_anita" }));
    expect(await view()).toBeUndefined();
  });

  it("paused sessions don't receive updates", async () => {
    const r = await (await publish(req("POST", "", { as: "demo_priya", body: { location: loc() } }), params())).json();
    expect(r.updatedSessions).toBe(1); // Anita active, Rajesh paused
  });

  it("other users cannot control someone else's share", async () => {
    const res = await updateShare(req("PATCH", "", { as: "demo_anita", body: { action: "resume" } }), params({ id: "loc_demo_rajesh" }));
    expect(res.status).toBe(403);
  });

  it("temporary shares expire", async () => {
    await startShare(req("POST", "", { as: "demo_priya", body: { contactId: "tc_demo_meera", mode: "temporary", durationMinutes: 5 } }), params());
    const [s] = await store.query<{ id: string }>(COLLECTIONS.locationSessions, { where: [where("contactId", "==", "tc_demo_meera")] });
    await store.update(COLLECTIONS.locationSessions, s.id, { expiresAt: new Date(Date.now() - 1000).toISOString(), lastLocation: loc() });
    const shared = (await (await sharedWithMe(req("GET", "", { as: "demo_meera" }), params())).json()).shared[0];
    expect(shared.status).toBe("expired");
    expect(shared.location).toBeNull();
  });
});

describe("Safe Journey check-ins and escalation", () => {
  async function begin(autoEscalate = true) {
    const body = {
      origin: "Office, Cyber City", destination: "Home, Saket",
      expectedArrivalAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      checkInIntervalMinutes: 15, gracePeriodMinutes: 5, autoEscalate, contactIds: ["tc_demo_anita"],
    };
    const res = await startJourney(req("POST", "", { as: "demo_priya", body }), params());
    expect(res.status).toBe(200);
    return (await res.json()).journey as { id: string };
  }
  const minutes = (m: number) => new Date(Date.now() + m * 60_000);

  it("reminds the user once, then escalates to journey contacts after the grace period", async () => {
    const j = await begin();
    await processJourney(j.id, minutes(16));
    await processJourney(j.id, minutes(17)); // second call must not duplicate the reminder
    const reminders = await store.query<AppNotification>(COLLECTIONS.notifications, { where: [where("recipientUserId", "==", "demo_priya"), where("type", "==", "journey_checkin_due")] });
    expect(reminders).toHaveLength(1);

    const { journey } = await processJourney(j.id, minutes(21));
    expect(journey?.status).toBe("escalated");
    const event = await store.get<EmergencyEvent>(COLLECTIONS.emergencyEvents, journey!.escalatedEventId!);
    expect(event?.trigger).toBe("journey_missed_checkin");
    expect(event?.authorizedViewerIds).toEqual(["demo_anita"]); // only journey contacts
  });

  it("checking in resets the timer", async () => {
    const j = await begin();
    await updateJourney(req("PATCH", "", { as: "demo_priya", body: { action: "check_in" } }), params({ id: j.id }));
    expect((await processJourney(j.id, minutes(10))).state.kind).toBe("ok");
  });

  it("does not escalate when auto-escalation is off", async () => {
    const j = await begin(false);
    expect((await processJourney(j.id, minutes(90))).journey?.status).toBe("active");
  });

  it("allows only one active journey", async () => {
    await begin();
    const body = { origin: "A", destination: "B", expectedArrivalAt: minutes(30).toISOString(), checkInIntervalMinutes: 15, gracePeriodMinutes: 5, autoEscalate: true, contactIds: ["tc_demo_anita"] };
    expect((await startJourney(req("POST", "", { as: "demo_priya", body }), params())).status).toBe(409);
  });
});
