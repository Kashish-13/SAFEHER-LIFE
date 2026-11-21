"use client";

import { AlertTriangle, Car, CheckCircle2, Clock, Flag, MapPin, Plus, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { JourneyState } from "@/core/journey";
import type { JourneySession, TrustedContact } from "@/core/types";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge, LoadingBlock } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api-client";
import { cn, formatDateTime, formatTime } from "@/lib/utils";

type Journey = JourneySession & { state: JourneyState };

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ActiveJourney({ j, onChange }: { j: Journey; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const due = j.state.kind === "checkin_due" || j.state.kind === "arrival_overdue";
  const escalated = j.status === "escalated";

  // While open, apply the journey policy (reminders/escalation). The cron job is the backstop.
  useEffect(() => {
    if (j.status !== "active") return;
    const t = setInterval(() => api(`/api/journeys/${j.id}/evaluate`, { method: "POST" }).then(onChange).catch(() => {}), 20_000);
    return () => clearInterval(t);
  }, [j.id, j.status, onChange]);

  const act = async (action: string, msg: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try { await api(`/api/journeys/${j.id}`, { method: "PATCH", body: { action, ...extra } }); toast(msg); onChange(); }
    catch (e) { toast((e as Error).message, "error"); } finally { setBusy(null); }
  };

  return (
    <Card className={cn(due && "border-warning", escalated && "border-emergency")}>
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge tone={escalated ? "emergency" : due ? "warning" : "success"}>{escalated ? "Escalated to contacts" : due ? "Check-in due" : "Journey in progress"}</Badge>
            <h2 className="mt-2 text-xl font-bold">{j.origin} → {j.destination}</h2>
            <p className="text-sm text-muted-foreground">Started {formatTime(j.startedAt)} · Expected by {formatTime(j.expectedArrivalAt)}</p>
          </div>
          <div className="text-right text-sm">
            {j.state.kind === "ok" && <p><Clock className="mr-1 inline size-4" />Next check-in in <strong>{j.state.minutesUntilDue} min</strong></p>}
            {due && <p className="font-semibold text-warning"><AlertTriangle className="mr-1 inline size-4" />Overdue by {"minutesOverdue" in j.state ? j.state.minutesOverdue : 0} min</p>}
          </div>
        </div>

        {due && (
          <Alert tone="warning" title="Are you safe?">
            {j.autoEscalate ? `If you don't check in within ${j.gracePeriodMinutes} minutes of the due time, your journey contacts will be alerted.` : "Auto-escalation is off, so your contacts won't be alerted automatically."}
          </Alert>
        )}
        {escalated && (
          <Alert tone="emergency" title="Your contacts were alerted">
            You missed a check-in. {j.escalatedEventId && <Link className="font-semibold underline" href={`/emergency/${j.escalatedEventId}`}>View the alert</Link>}. If you&apos;re safe, mark yourself safe there.
          </Alert>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" variant="accent" loading={busy === "check_in"} onClick={() => act("check_in", "Checked in. Timer reset.")}><ShieldCheck /> I&apos;m safe: check in</Button>
          <Button size="lg" variant="outline" loading={busy === "arrived"} onClick={() => act("arrived", "Arrival confirmed. Contacts notified.")}><Flag /> I&apos;ve arrived</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" loading={busy === "extend"} onClick={() => act("extend", "Extended by 15 minutes", { extendMinutes: 15 })}><Plus />15 min</Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" loading={busy === "cancel"} onClick={() => confirm("End this journey without confirming arrival?") && act("cancel", "Journey ended")}><X />End journey</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function JourneyPage() {
  const toast = useToast();
  const journeys = useApi<{ journeys: Journey[] }>("/api/journeys", { pollMs: 30_000 });
  const contacts = useApi<{ contacts: TrustedContact[] }>("/api/contacts");
  const [selected, setSelected] = useState<string[]>([]);
  const [autoEscalate, setAutoEscalate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = journeys.data?.journeys.find((j) => j.status === "active" || (j.status === "escalated" && !j.endedAt));
  const past = journeys.data?.journeys.filter((j) => j !== active) ?? [];
  const accepted = (contacts.data?.contacts ?? []).filter((c) => c.status === "accepted");

  return (
    <div className="space-y-6">
      <PageHeader title="Safe Journey Guardian" description="Share your trip and check in along the way. If you miss a check-in, we ask you first." />
      {journeys.loading ? <LoadingBlock rows={2} /> : active ? <ActiveJourney j={active} onChange={journeys.reload} /> : (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Car className="size-4 text-accent" />Start a journey</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true); setError(null);
              try {
                await api("/api/journeys", { body: {
                  origin: f.get("origin"), destination: f.get("destination"),
                  expectedArrivalAt: new Date(String(f.get("eta"))).toISOString(),
                  checkInIntervalMinutes: Number(f.get("interval")), gracePeriodMinutes: Number(f.get("grace")),
                  autoEscalate, contactIds: selected,
                } });
                toast("Journey started. Your contacts were notified.");
                journeys.reload();
              } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
            }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="origin" label="Starting point"><Input id="origin" name="origin" required maxLength={160} placeholder="e.g. Office, Cyber City" /></Field>
                <Field id="destination" label="Destination"><Input id="destination" name="destination" required maxLength={160} placeholder="e.g. Home, Saket" /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="eta" label="Expected arrival"><Input id="eta" name="eta" type="datetime-local" required defaultValue={toLocalInput(new Date(Date.now() + 45 * 60_000))} /></Field>
                <Field id="interval" label="Check in every">
                  <Select id="interval" name="interval" defaultValue="15">{[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}</Select>
                </Field>
                <Field id="grace" label="Grace period">
                  <Select id="grace" name="grace" defaultValue="5">{[2, 5, 10, 15].map((m) => <option key={m} value={m}>{m} minutes</option>)}</Select>
                </Field>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Who should know about this journey?</legend>
                {accepted.length === 0 ? <p className="text-sm text-muted-foreground">You need at least one accepted contact. <Link href="/circle" className="font-semibold text-accent">Add contacts</Link></p> : (
                  <div className="flex flex-wrap gap-2">
                    {accepted.map((c) => {
                      const on = selected.includes(c.id);
                      return (
                        <button type="button" key={c.id} aria-pressed={on} onClick={() => setSelected((s) => on ? s.filter((x) => x !== c.id) : [...s, c.id])}
                          className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm", on ? "border-accent bg-accent/10 font-semibold text-accent" : "hover:bg-secondary")}>
                          {on && <CheckCircle2 className="size-3.5" />}{c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </fieldset>
              <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
                <label htmlFor="ae" className="text-sm"><strong>Alert my contacts if I don&apos;t respond</strong><br /><span className="text-muted-foreground">After a missed check-in and the grace period. You&apos;ll always be reminded first.</span></label>
                <Switch id="ae" checked={autoEscalate} onCheckedChange={setAutoEscalate} />
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="size-3.5" />Route-deviation warnings will use GPS in the native app. They&apos;ll ask you first and never assume an emergency.</p>
              {error && <Alert tone="emergency">{error}</Alert>}
              <Button type="submit" size="lg" className="w-full" loading={busy} disabled={selected.length === 0}>Start journey</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {past.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Journey history</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {past.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{j.origin} → {j.destination}</p><p className="text-xs text-muted-foreground">{formatDateTime(j.startedAt)} · {j.missedCheckIns} missed check-ins</p></div>
                  <Badge tone={j.status === "arrived" ? "success" : j.status === "escalated" ? "emergency" : "neutral"} className="capitalize">{j.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
