import type { GeoPoint, HelperProfile } from "./types";

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(a: Pick<GeoPoint, "lat" | "lng">, b: Pick<GeoPoint, "lat" | "lng">): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rounds a distance into a coarse, privacy-preserving label so that a helper
 * cannot triangulate the requester's exact position from repeated requests.
 */
export function approximateDistanceLabel(km: number): string {
  if (km < 0.5) return "Under 500 m";
  if (km < 1) return "Under 1 km";
  if (km < 5) return `About ${Math.round(km)} km`;
  return `About ${Math.round(km / 5) * 5} km`;
}

/** Reduces coordinate precision (~1.1 km at 2 decimals) before sharing with non-trusted parties. */
export function coarsenLocation(p: Pick<GeoPoint, "lat" | "lng">, decimals = 2): { lat: number; lng: number } {
  const f = 10 ** decimals;
  return { lat: Math.round(p.lat * f) / f, lng: Math.round(p.lng * f) / f };
}

export interface HelperMatch {
  helperId: string;
  userId: string;
  displayName: string;
  distanceKm: number;
  distanceLabel: string;
}

/**
 * Selects helpers eligible to receive an assistance request. Only helpers who
 * are verified, opted-in, currently available, have a fresh location, and whose
 * own service radius covers the requester are included. The requester is never
 * matched with themselves.
 */
export function matchHelpers(
  helpers: HelperProfile[],
  requester: { userId: string; location: Pick<GeoPoint, "lat" | "lng"> },
  opts: { maxRadiusKm: number; maxResults: number; now: Date; maxLocationAgeMinutes?: number },
): HelperMatch[] {
  const maxAgeMs = (opts.maxLocationAgeMinutes ?? 30) * 60_000;
  return helpers
    .filter(
      (h) =>
        h.verificationStatus === "verified" &&
        h.optedIn &&
        h.available &&
        h.userId !== requester.userId &&
        h.lastKnownLocation !== null &&
        opts.now.getTime() - new Date(h.lastKnownLocation.capturedAt).getTime() <= maxAgeMs,
    )
    .map((h) => {
      const d = distanceKm(requester.location, h.lastKnownLocation!);
      return { h, d };
    })
    .filter(({ h, d }) => d <= opts.maxRadiusKm && d <= h.serviceRadiusKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, opts.maxResults)
    .map(({ h, d }) => ({
      helperId: h.id,
      userId: h.userId,
      displayName: h.displayName,
      distanceKm: Math.round(d * 10) / 10,
      distanceLabel: approximateDistanceLabel(d),
    }));
}
