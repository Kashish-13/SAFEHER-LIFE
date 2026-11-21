"use client";

import { MapPin, Phone, Siren, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EmergencyEvent, EmergencyTrigger, GeoPoint } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { useAuth } from "@/hooks/use-auth";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useSafetyStatus } from "@/hooks/use-safety-status";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Phase = "idle" | "confirm" | "countdown" | "sending" | "error";

/**
 * The SOS control. Flow: press → (optional confirm) → cancel countdown → send.
 * Location is requested in parallel with the countdown so it never delays the alert;
 * if it's unavailable the alert is sent without it.
 */
export function SosButton({ size = "lg", trigger = "manual", onSent }: { size?: "lg" | "md"; trigger?: EmergencyTrigger; onSent?: (e: EmergencyEvent) => void }) {
  const { profile } = useAuth();
  const { activeEmergency, refresh } = useSafetyStatus();
  const { getCurrent } = useGeolocation();
  const router = useRouter();
  const prefs = profile!.emergencyPreferences;

  const [phase, setPhase] = useState<Phase>("idle");
  const [remaining, setRemaining] = useState(prefs.cancelWindowSeconds);
  const [error, setError] = useState<string | null>(null);
  const locationPromise = useRef<Promise<GeoPoint | null> | null>(null);
  const [locStatus, setLocStatus] = useState<"pending" | "ok" | "none">("pending");

  const send = useCallback(async () => {
    setPhase("sending");
    try {
      const location = prefs.shareLocationOnSOS ? await Promise.race([locationPromise.current ?? Promise.resolve(null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]) : null;
      const { event } = await api<{ event: EmergencyEvent }>("/api/emergencies", { method: "POST", body: { trigger, location } });
      await refresh();
      onSent?.(event);
      router.push(`/emergency/${event.id}`);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }, [prefs.shareLocationOnSOS, trigger, refresh, onSent, router]);

  const startCountdown = useCallback(() => {
    if (prefs.shareLocationOnSOS) {
      setLocStatus("pending");
      locationPromise.current = getCurrent(6000).then((p) => { setLocStatus(p ? "ok" : "none"); return p; });
    } else {
      setLocStatus("none");
    }
    if (prefs.cancelWindowSeconds === 0) { send(); return; }
    setRemaining(prefs.cancelWindowSeconds);
    setPhase("countdown");
  }, [prefs.shareLocationOnSOS, prefs.cancelWindowSeconds, getCurrent, send]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (remaining <= 0) { send(); return; }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, remaining, send]);

  const press = () => {
    if (activeEmergency) { router.push(`/emergency/${activeEmergency.id}`); return; }
    setError(null);
    if (prefs.confirmBeforeSOS) setPhase("confirm");
    else startCountdown();
  };

  const dim = size === "lg" ? "size-52 sm:size-60" : "size-40";

  return (
    <div className="flex flex-col items-center">
      {phase === "countdown" || phase === "sending" ? (
        <div className="flex flex-col items-center" role="alertdialog" aria-live="assertive" aria-label="Sending emergency alert">
          <div className={cn("relative grid place-items-center rounded-full bg-emergency text-white shadow-sos", dim)}>
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-emergency/40" />
            <div className="relative text-center">
              {phase === "sending" ? <p className="text-xl font-bold">Sending…</p> : (
                <><p className="font-display text-6xl font-extrabold tabular-nums">{remaining}</p><p className="text-sm font-semibold opacity-90">Alerting your circle</p></>
              )}
            </div>
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5" />
            {!prefs.shareLocationOnSOS ? "Location sharing during SOS is off" : locStatus === "pending" ? "Getting your location…" : locStatus === "ok" ? "Location ready" : "Location unavailable: alert will be sent without it"}
          </p>
          {phase === "countdown" && (
            <Button variant="outline" size="lg" className="mt-4 min-w-48 border-2" onClick={() => setPhase("idle")}><X /> Cancel. I&apos;m OK</Button>
          )}
        </div>
      ) : (
        <button
          onClick={press}
          className={cn("group relative grid place-items-center rounded-full bg-gradient-to-b from-[hsl(356_80%_56%)] to-emergency text-white shadow-sos transition active:scale-95", dim)}
          aria-label={activeEmergency ? "Emergency active: view status" : "Send SOS emergency alert to your trusted circle"}
        >
          <span className="absolute inset-0 animate-pulse-ring rounded-full bg-emergency/25" />
          <span className="relative text-center">
            <Siren className="mx-auto size-10 sm:size-12" aria-hidden />
            <span className="mt-1 block font-display text-4xl font-extrabold tracking-widest sm:text-5xl">SOS</span>
            <span className="text-xs font-semibold opacity-90">{activeEmergency ? "Alert active: view" : "Tap to alert your circle"}</span>
          </span>
        </button>
      )}

      {phase === "confirm" && (
        <div className="mt-5 w-full max-w-sm animate-fade-in rounded-2xl border bg-card p-4 text-center shadow-soft">
          <p className="font-semibold">Send an emergency alert?</p>
          <p className="mt-1 text-sm text-muted-foreground">Your trusted contacts will be notified immediately.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setPhase("idle")}>Cancel</Button>
            <Button variant="emergency" onClick={startCountdown}>Yes, send SOS</Button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="mt-5 w-full max-w-sm space-y-3">
          <Alert tone="emergency" title="Alert could not be sent">{error}</Alert>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={send}>Retry</Button>
            <Button asChild variant="emergency"><a href="tel:112"><Phone /> Call 112</a></Button>
          </div>
        </div>
      )}
    </div>
  );
}
