"use client";

import { useCallback, useEffect, useState } from "react";
import type { GeoPoint } from "@/core/types";

export type GeoPermission = "granted" | "denied" | "prompt" | "unsupported" | "unknown";

/**
 * Foreground-only geolocation. The browser shows its own permission prompt;
 * we never request location in the background or without a user action/consent.
 */
export function useGeolocation() {
  const [permission, setPermission] = useState<GeoPermission>("unknown");

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) { setPermission("unsupported"); return; }
    navigator.permissions?.query({ name: "geolocation" as PermissionName })
      .then((s) => { setPermission(s.state as GeoPermission); s.onchange = () => setPermission(s.state as GeoPermission); })
      .catch(() => setPermission("unknown"));
  }, []);

  /** Resolves with the current position, or null if unavailable/denied within `timeoutMs`. Never throws. */
  const getCurrent = useCallback((timeoutMs = 8000): Promise<GeoPoint | null> => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return Promise.resolve(null);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), capturedAt: new Date(p.timestamp).toISOString(), source: "browser" }),
        (err) => { if (err.code === err.PERMISSION_DENIED) setPermission("denied"); resolve(null); },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
      );
    });
  }, []);

  return { permission, getCurrent };
}
