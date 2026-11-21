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
  refresh: () => Promise<void>;
}

const Ctx = createContext<SafetyStatus>({ activeEmergency: null, incomingAlerts: [], unreadNotifications: 0, refresh: async () => {} });

/**
 * App-wide safety status, polled while the app is visible. This is how a
 * trusted contact with the web app open sees an incoming alert even without
 * push notifications configured.
 */
export function SafetyStatusProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [activeEmergency, setActive] = useState<EmergencyEvent | null>(null);
  const [incomingAlerts, setIncoming] = useState<IncomingAlert[]>([]);
  const [unreadNotifications, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    const [h, a, n] = await Promise.allSettled([
      api<{ events: EmergencyEvent[] }>("/api/emergencies"),
      api<{ alerts: IncomingAlert[] }>("/api/alerts"),
      api<{ unread: number }>("/api/notifications"),
    ]);
    if (h.status === "fulfilled") setActive(h.value.events.find((e) => e.status === "active") ?? null);
    if (a.status === "fulfilled") setIncoming(a.value.alerts.filter((x) => x.status === "active"));
    if (n.status === "fulfilled") setUnread(n.value.unread);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), 8000);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [enabled, refresh]);

  return <Ctx.Provider value={{ activeEmergency, incomingAlerts, unreadNotifications, refresh }}>{children}</Ctx.Provider>;
}

export const useSafetyStatus = () => useContext(Ctx);
