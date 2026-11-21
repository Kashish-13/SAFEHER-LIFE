import { describe, expect, it } from "vitest";
import { contactCreateSchema, emergencyCreateSchema, journeyCreateSchema, locationShareCreateSchema, voiceSosSchema } from "@/core/validation";

describe("API validation schemas", () => {
  it("sanitises text input", () => {
    const r = contactCreateSchema.parse({ name: "  <script>Anita</script>  ", relationship: "Mother", email: "A@Example.com", priority: "primary" });
    expect(r.name).toBe("scriptAnita/script");
    expect(r.email).toBe("a@example.com");
  });

  it("requires email or phone for a contact", () => {
    expect(contactCreateSchema.safeParse({ name: "A", relationship: "B", priority: "primary" }).success).toBe(false);
  });

  it("validates phone numbers with country code", () => {
    expect(contactCreateSchema.safeParse({ name: "A", relationship: "B", priority: "primary", phone: "+91 98765 43210" }).success).toBe(true);
    expect(contactCreateSchema.safeParse({ name: "A", relationship: "B", priority: "primary", phone: "12" }).success).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    const bad = { trigger: "manual", location: { lat: 200, lng: 0, capturedAt: new Date().toISOString(), source: "browser" } };
    expect(emergencyCreateSchema.safeParse(bad).success).toBe(false);
    expect(emergencyCreateSchema.safeParse({ trigger: "manual", location: null }).success).toBe(true);
  });

  it("only accepts known triggers (journey escalation is server-only)", () => {
    expect(emergencyCreateSchema.safeParse({ trigger: "journey_missed_checkin", location: null }).success).toBe(false);
  });

  it("requires multi-word voice phrases", () => {
    expect(voiceSosSchema.safeParse({ enabled: true, phrase: "help", sensitivity: 0.5, falseActivationWindowSeconds: 10 }).success).toBe(false);
    expect(voiceSosSchema.safeParse({ enabled: true, phrase: "Help Help", sensitivity: 0.5, falseActivationWindowSeconds: 10 }).success).toBe(true);
  });

  it("requires a duration for temporary location sharing", () => {
    expect(locationShareCreateSchema.safeParse({ contactId: "c", mode: "temporary" }).success).toBe(false);
    expect(locationShareCreateSchema.safeParse({ contactId: "c", mode: "temporary", durationMinutes: 60 }).success).toBe(true);
  });

  it("requires at least one journey contact", () => {
    const j = { origin: "A", destination: "B", expectedArrivalAt: new Date().toISOString(), checkInIntervalMinutes: 15, gracePeriodMinutes: 5, autoEscalate: true, contactIds: [] };
    expect(journeyCreateSchema.safeParse(j).success).toBe(false);
  });
});
