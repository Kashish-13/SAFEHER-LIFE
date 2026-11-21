import { describe, expect, it } from "vitest";
import { approximateDistanceLabel, coarsenLocation, distanceKm, matchHelpers } from "@/core/geo";
import type { HelperProfile } from "@/core/types";

const now = new Date("2026-01-01T12:00:00Z");
const fresh = now.toISOString();
const cp = { lat: 28.6315, lng: 77.2167 }; // Connaught Place

const helper = (id: string, lat: number, lng: number, over: Partial<HelperProfile> = {}): HelperProfile => ({
  id, userId: `u_${id}`, displayName: id, verificationStatus: "verified", available: true, optedIn: true,
  lastKnownLocation: { lat, lng, capturedAt: fresh, source: "device_gps" }, serviceRadiusKm: 5, createdAt: "", updatedAt: "", ...over,
});

describe("geo + helper matching", () => {
  it("computes realistic distances", () => {
    // CP → India Gate ≈ 2.3 km
    expect(distanceKm(cp, { lat: 28.6129, lng: 77.2295 })).toBeGreaterThan(2);
    expect(distanceKm(cp, { lat: 28.6129, lng: 77.2295 })).toBeLessThan(2.8);
  });

  it("only matches verified, opted-in, available helpers within range", () => {
    const helpers = [
      helper("near", 28.632, 77.217),
      helper("unverified", 28.632, 77.217, { verificationStatus: "pending" }),
      helper("busy", 28.632, 77.217, { available: false }),
      helper("optout", 28.632, 77.217, { optedIn: false }),
      helper("far", 28.9, 77.5),
      helper("stale", 28.632, 77.217, { lastKnownLocation: { lat: 28.632, lng: 77.217, capturedAt: "2025-12-31T00:00:00Z", source: "device_gps" } }),
      helper("self", 28.632, 77.217, { userId: "requester" }),
    ];
    const m = matchHelpers(helpers, { userId: "requester", location: cp }, { maxRadiusKm: 10, maxResults: 5, now });
    expect(m.map((x) => x.helperId)).toEqual(["near"]);
    expect(m[0].distanceLabel).toBe("Under 500 m");
  });

  it("sorts by distance and respects each helper's own service radius", () => {
    const helpers = [helper("b", 28.65, 77.22), helper("a", 28.635, 77.217), helper("small", 28.64, 77.217, { serviceRadiusKm: 0.5 })];
    expect(matchHelpers(helpers, { userId: "x", location: cp }, { maxRadiusKm: 10, maxResults: 5, now }).map((h) => h.helperId)).toEqual(["a", "b"]);
  });

  it("location-sharing access requires a live session for the linked viewer", async () => {
    const { canViewLocation } = await import("@/core/location-sharing");
    const s = { status: "active" as const, expiresAt: null, contactUserId: "mom" };
    expect(canViewLocation(s, "mom", now)).toBe(true);
    expect(canViewLocation(s, "stranger", now)).toBe(false);
    expect(canViewLocation({ ...s, status: "paused" }, "mom", now)).toBe(false);
    expect(canViewLocation({ ...s, expiresAt: "2025-01-01T00:00:00Z" }, "mom", now)).toBe(false);
  });

  it("produces privacy-preserving approximations", () => {
    expect(approximateDistanceLabel(3.4)).toBe("About 3 km");
    expect(approximateDistanceLabel(12)).toBe("About 10 km");
    expect(coarsenLocation({ lat: 28.631523, lng: 77.216712 })).toEqual({ lat: 28.63, lng: 77.22 });
  });
});
