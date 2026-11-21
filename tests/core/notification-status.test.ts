import { describe, expect, it } from "vitest";
import { applyStatus, canTransition, InvalidTransitionError, summarizeResponses } from "@/core/notification-status";
import type { EmergencyResponse } from "@/core/types";

const base: EmergencyResponse = {
  id: "r1", eventId: "e1", ownerId: "u1", contactId: "c1", contactUserId: "u2", contactName: "A",
  tier: "primary", channels: ["in_app"], status: "queued", history: [{ status: "queued", at: "t0" }],
  failureReason: null, createdAt: "t0", updatedAt: "t0",
};

describe("notification delivery states", () => {
  it("follows the forward-only lifecycle", () => {
    let r = applyStatus(base, "sent", "t1");
    r = applyStatus(r, "delivered", "t2");
    r = applyStatus(r, "acknowledged", "t3");
    expect(r.status).toBe("acknowledged");
    expect(r.history.map((h) => h.status)).toEqual(["queued", "sent", "delivered", "acknowledged"]);
  });

  it("never allows jumping from queued straight to delivered or acknowledged", () => {
    expect(canTransition("queued", "delivered")).toBe(false);
    expect(canTransition("queued", "acknowledged")).toBe(false);
    expect(() => applyStatus(base, "acknowledged", "t1")).toThrow(InvalidTransitionError);
  });

  it("does not allow reverting an acknowledgement", () => {
    const ack = applyStatus(applyStatus(base, "sent", "t1"), "acknowledged", "t2");
    expect(() => applyStatus(ack, "sent", "t3")).toThrow();
    expect(() => applyStatus(ack, "failed", "t3")).toThrow();
  });

  it("records failure reasons and is idempotent", () => {
    const failed = applyStatus(base, "failed", "t1", "No account");
    expect(failed.failureReason).toBe("No account");
    expect(applyStatus(failed, "failed", "t2")).toBe(failed);
  });

  it("summarises responses for the dashboard", () => {
    const s = summarizeResponses([{ status: "sent" }, { status: "delivered" }, { status: "acknowledged" }, { status: "failed" }]);
    expect(s).toMatchObject({ total: 4, acknowledged: 1, failed: 1, awaiting: 2 });
  });
});
