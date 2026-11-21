"use client";

import { Clock, Infinity as InfinityIcon, LocateFixed, MapPin, Pause, Play, Radio, Square, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GeoPoint, LocationSession, TrustedContact } from "@/core/types";
import { PageHeader } from "@/components/layout/page-header";
import { LocationMap } from "@/components/maps/location-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge, EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/hooks/use-api";
import { useGeolocation } from "@/hooks/use-geolocation";
import { api } from "@/lib/api-client";
import { formatTime, initials, timeAgo } from "@/lib/utils";

type Session = LocationSession & { effectiveStatus: "active" | "paused" | "stopped" | "expired" };
interface Shared { id: string; ownerName: string; mode: string; status: string; expiresAt: string | null; location: GeoPoint | null; lastUpdatedAt: string | null }

const DURATIONS = [[30, "30 minutes"], [60, "1 hour"], [120, "2 hours"], [240, "4 hours"], [480, "8 hours"]] as const;

export default function LocationPage() {
  const toast = useToast();
  const { permission, getCurrent } = useGeolocation();
  const sessions = useApi<{ sessions: Session[] }>("/api/location/sessions");
  const contacts = useApi<{ contacts: TrustedContact[] }>("/api/contacts");
  const shared = useApi<{ shared: Shared[] }>("/api/location/shared-with-me", { pollMs: 15000 });
  const [contactId, setContactId] = useState("");
  const [mode, setMode] = useState<"always" | "temporary">("temporary");
  const [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState<string | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  const mine = sessions.data?.sessions ?? [];
  const sharingIds = new Set(mine.map((s) => s.contactId));
  const eligible = (contacts.data?.contacts ?? []).filter((c) => c.status === "accepted" && !sharingIds.has(c.id));
  const live = mine.filter((s) => s.effectiveStatus === "active");

  const publish = async (p: GeoPoint) => {
    const r = await api<{ updatedSessions: number }>("/api/location/update", { body: { location: p } });
    setLastSent(p.capturedAt);
    return r.updatedSessions;
  };

  // Foreground-only live updates while this page is open AND the user turned it on.
  useEffect(() => {
    if (!autoUpdate || !("geolocation" in navigator)) return;
    let last = 0;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last < 30_000) return; // throttle to every 30s
        last = Date.now();
        publish({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), capturedAt: new Date(pos.timestamp).toISOString(), source: "browser" }).catch(() => {});
      },
      () => { setAutoUpdate(false); toast("Location permission denied", "error"); },
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); };
  }, [autoUpdate, toast]);

  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); toast(msg); sessions.reload(); } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Family location sharing" description="You decide who sees your location, and for how long. Revoke access at any time." />

      <Alert tone="neutral" title="How location works on the web">
        Your position is sent only while SafeHer is open in this tab and you&apos;ve allowed it. There is no background or hidden tracking.
        Contacts always see when it was last updated.
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>You&apos;re sharing with</CardTitle>
            <Badge tone={live.length ? "success" : "neutral"}><Radio />{live.length} live</Badge>
          </CardHeader>
          <CardContent>
            {sessions.loading ? <LoadingBlock rows={2} /> : mine.length === 0 ? (
              <EmptyState icon={MapPin} title="Not sharing with anyone" description="Start sharing with a trusted contact below." className="py-8" />
            ) : (
              <ul className="divide-y">
                {mine.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 py-3.5">
                    <span className="grid size-10 place-items-center rounded-full bg-primary text-xs font-bold text-white">{initials(s.contactName)}</span>
                    <div className="min-w-[140px] flex-1">
                      <p className="font-semibold">{s.contactName}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        {s.mode === "always" ? <><InfinityIcon className="size-3" /> Always</> : <><Clock className="size-3" /> Until {formatTime(s.expiresAt)}</>}
                        {" · "}last update {timeAgo(s.lastUpdatedAt)}
                      </p>
                    </div>
                    <Badge tone={s.effectiveStatus === "active" ? "success" : s.effectiveStatus === "paused" ? "warning" : "neutral"} className="capitalize">{s.effectiveStatus}</Badge>
                    <div className="flex gap-1">
                      {s.effectiveStatus === "active" && <Button size="sm" variant="outline" loading={busy === `p${s.id}`} onClick={() => act(`p${s.id}`, () => api(`/api/location/sessions/${s.id}`, { method: "PATCH", body: { action: "pause" } }), "Sharing paused")}><Pause />Pause</Button>}
                      {s.effectiveStatus === "paused" && <Button size="sm" variant="outline" loading={busy === `r${s.id}`} onClick={() => act(`r${s.id}`, () => api(`/api/location/sessions/${s.id}`, { method: "PATCH", body: { action: "resume" } }), "Sharing resumed")}><Play />Resume</Button>}
                      {s.effectiveStatus === "expired" && <Button size="sm" variant="outline" onClick={() => act(`x${s.id}`, () => api("/api/location/sessions", { body: { contactId: s.contactId, mode: "temporary", durationMinutes: 60 } }), "Shared for another hour")}><Play />Extend 1h</Button>}
                      <Button size="sm" variant="ghost" className="text-emergency" loading={busy === `s${s.id}`} onClick={() => act(`s${s.id}`, () => api(`/api/location/sessions/${s.id}`, { method: "PATCH", body: { action: "stop" } }), "Access revoked")}><Square />Stop</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {live.length > 0 && (
              <div className="mt-4 space-y-3 rounded-xl bg-secondary/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="auto" className="text-sm"><strong>Live updates while this page is open</strong><br /><span className="text-xs text-muted-foreground">Sends your position about every 30 seconds.</span></label>
                  <Switch id="auto" checked={autoUpdate} onCheckedChange={setAutoUpdate} disabled={permission === "denied" || permission === "unsupported"} />
                </div>
                <Button variant="outline" className="w-full" loading={busy === "now"} onClick={() => act("now", async () => {
                  const p = await getCurrent();
                  if (!p) throw new Error("Couldn't get your location. Check browser permission.");
                  await publish(p);
                }, "Location sent to your live shares")}><LocateFixed />Send my location now</Button>
                {lastSent && <p className="text-center text-xs text-muted-foreground">Last sent {timeAgo(lastSent)}</p>}
                {permission === "denied" && <p className="text-xs text-emergency">Location permission is blocked for this site in your browser settings.</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Start sharing</CardTitle></CardHeader>
          <CardContent>
            {contacts.loading ? <LoadingBlock rows={1} /> : eligible.length === 0 ? (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Only contacts who have <strong>accepted</strong> your invitation can see your location{mine.length ? ", and you're already sharing with all of them" : ""}.</p>
                <Button asChild variant="outline" size="sm"><Link href="/circle"><UserPlus />Manage contacts</Link></Button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={(e) => {
                e.preventDefault();
                act("start", () => api("/api/location/sessions", { body: { contactId, mode, durationMinutes: mode === "temporary" ? duration : null } }), "Sharing started");
              }}>
                <Field id="contact" label="Share with">
                  <Select id="contact" value={contactId} onChange={(e) => setContactId(e.target.value)} required>
                    <option value="" disabled>Choose a contact…</option>
                    {eligible.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.relationship})</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Sharing mode">
                  {(["temporary", "always"] as const).map((m) => (
                    <button type="button" key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                      className={`rounded-xl border p-3 text-left text-sm ${mode === m ? "border-accent bg-accent/5 ring-1 ring-accent" : ""}`}>
                      <strong className="block capitalize">{m}</strong>
                      <span className="text-xs text-muted-foreground">{m === "always" ? "Until you stop it" : "Ends automatically"}</span>
                    </button>
                  ))}
                </div>
                {mode === "temporary" && (
                  <Field id="dur" label="Duration">
                    <Select id="dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>{DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                  </Field>
                )}
                <Button type="submit" className="w-full" loading={busy === "start"} disabled={!contactId}>Start sharing</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Shared with you</h2>
        {shared.loading ? <LoadingBlock rows={1} /> : (shared.data?.shared.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No one is sharing their location with you right now.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {shared.data!.shared.map((s) => (
              <Card key={s.id}>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{s.ownerName}</p>
                    <Badge tone={s.status === "active" ? "success" : "neutral"} className="capitalize">{s.status}</Badge>
                  </div>
                  {s.location ? <LocationMap point={s.location} label={`${s.ownerName}'s location`} height={180} /> : (
                    <p className="rounded-xl bg-secondary/60 p-4 text-sm text-muted-foreground">
                      {s.status === "paused" ? "Sharing is paused." : s.status === "expired" ? "This temporary share has ended." : "No location received yet."}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
