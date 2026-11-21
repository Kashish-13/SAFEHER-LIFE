"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { EmergencyEvent, ResponseStatus } from "@/core/types";
import { api } from "@/lib/api-client";

export interface IncomingAlert {
  eventId: string;
  fromName: string;
  status: EmergencyEvent["status"];
  isSimulated: boolean;
  createdAt: string;
  myResponse: ResponseStatus;
}

interface SafetyStatus {
  activeEmergency: EmergencyEvent | null;
  incomingAlerts: IncomingAlert[];
  unreadNotifications: number;
  pendingApprovals: number;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SafetyStatus>({ activeEmergency: null, incomingAlerts: [], unreadNotifications: 0, pendingApprovals: 0, refresh: async () => {} });

/** Poll interval while the tab is visible. Paused when hidden; refreshed on return. */
const POLL_MS = 20_000;

/**
 * App-wide safety status from ONE lightweight endpoint (/api/status).
 * This is how a trusted contact with SafeHer open sees an incoming alert before
 * web push exists (Phase 1). It is not a substitute for push or server-side escalation.
 */
export function SafetyStatusProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [state, setState] = useState<Omit<SafetyStatus, "refresh">>({ activeEmergency: null, incomingAlerts: [], unreadNotifications: 0, pendingApprovals: 0 });

  const refresh = useCallback(async () => {
    try {
      setState(await api<Omit<SafetyStatus, "refresh">>("/api/status"));
    } catch { /* keep last known state; pages show their own errors */ }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), POLL_MS);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [enabled, refresh]);

  return <Ctx.Provider value={{ ...state, refresh }}>{children}</Ctx.Provider>;
}

export const useSafetyStatus = () => useContext(Ctx);
