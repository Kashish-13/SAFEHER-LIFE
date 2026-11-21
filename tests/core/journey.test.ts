import { describe, expect, it } from "vitest";
import { evaluateJourney } from "@/core/journey";

const start = new Date("2026-01-01T18:00:00Z");
const min = (m: number) => new Date(start.getTime() + m * 60_000);
const journey = {
  status: "active" as const,
  lastCheckInAt: start.toISOString(),
  checkInIntervalMinutes: 15,
  gracePeriodMinutes: 5,
  autoEscalate: true,
  expectedArrivalAt: min(60).toISOString(),
};

describe("Safe Journey check-ins", () => {
  it("is ok before the next check-in", () => {
    expect(evaluateJourney(journey, min(10))).toMatchObject({ kind: "ok", minutesUntilDue: 5 });
  });

  it("reminds the user first when a check-in is missed", () => {
    expect(evaluateJourney(journey, min(17)).kind).toBe("checkin_due");
  });

  it("escalates only after the grace period", () => {
    expect(evaluateJourney(journey, min(19)).kind).toBe("checkin_due");
    expect(evaluateJourney(journey, min(20)).kind).toBe("escalate");
  });

  it("never escalates automatically when the user opted out", () => {
    expect(evaluateJourney({ ...journey, autoEscalate: false }, min(120)).kind).toBe("checkin_due");
  });

  it("treats expected arrival as a deadline when it comes first", () => {
    const short = { ...journey, expectedArrivalAt: min(10).toISOString() };
    expect(evaluateJourney(short, min(12)).kind).toBe("arrival_overdue");
  });

  it("ignores ended journeys", () => {
    expect(evaluateJourney({ ...journey, status: "arrived" }, min(500)).kind).toBe("inactive");
  });
});
