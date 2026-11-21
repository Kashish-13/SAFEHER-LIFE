"use client";

import { CheckCircle2, Clock, FlaskConical, MapPin, Phone, RefreshCw, ShieldCheck, Siren, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ResponseSummary } from "@/core/notification-status";
import type { EmergencyEvent, EmergencyResponse } from "@/core/types";
import { TRIGGER_LABEL } from "@/components/emergency/labels";
import { ResponseList, ResponseStatusBadge } from "@/components/emergency/response-status";
import { LocationMap } from "@/components/maps/location-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useSafetyStatus } from "@/hooks/use-safety-status";
import { api } from "@/lib/api-client";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";

interface EventView { event: EmergencyEvent; responses: EmergencyResponse[]; summary: ResponseSummary; viewerIsOwner: boolean }
interface EscalationResult { escalated: boolean; decision: { reason: string; secondsRemaining?: number } }

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-xl bg-secondary/60 p-3 text-center"><p className={cn("text-2xl font-bold", tone)}>{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>;
}

export default function EmergencyPage() {
  const { id } = useParams<{ id: string }>();
  const { uid } = useAuth();
  const toast = useToast();
  const { refresh: refreshStatus } = useSafetyStatus();
  const { getCurrent } = useGeolocation();
  // Poll only while the emergency is live; closed events don't change.
  const [live, setLive] = useState(true);
  const { data, error, loading, reload } = useApi<EventView>(`/api/emergencies/${id}`, { pollMs: live ? 4000 : undefined });
  const [escalation, setEscalation] = useState<EscalationResult["decision"] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const active = data?.event.status === "active";
  useEffect(() => { if (data) setLive(data.event.status === "active"); }, [data]);
  const isOwner = data?.viewerIsOwner;

  // Owner's open screen drives the (idempotent) escalation check; the cron job is the backstop.
  useEffect(() => {
    if (!active || !isOwner) return;
    const run = () => api<EscalationResult>(`/api/emergencies/${id}/escalate`, { method: "POST" })
      .then((r) => { setEscalation(r.decision); if (r.escalated) { toast("No primary acknowledgement. Secondary contacts alerted.", "info"); reload(); } })
      .catch(() => {});
    run();
    const t = setInterval(run, 5000);
    return () => clearInterval(t);
  }, [active, isOwner, id, reload, toast]);

  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); toast(msg); await reload(); await refreshStatus(); } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(null); }
  };

  if (loading && !data) return <LoadingBlock rows={4} />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const { event, responses, summary } = data;
  const myResponse = responses.find((r) => r.contactUserId === uid);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {event.isSimulated && (
        <Alert tone="warning" title="Simulated emergency"><span className="flex items-center gap-1.5"><FlaskConical className="size-3.5" />This is demo/test data. No real person was alerted.</span></Alert>
      )}

      <div className={cn("rounded-3xl p-6 text-white", active ? "bg-gradient-to-br from-[hsl(356_78%_48%)] to-[hsl(345_70%_38%)]" : event.status === "resolved" ? "bg-success" : "bg-navy-800")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold opacity-90">
              {active ? <Siren className="size-4 animate-pulse" /> : event.status === "resolved" ? <ShieldCheck className="size-4" /> : <X className="size-4" />}
              {active ? "Emergency active" : event.status === "resolved" ? "Resolved: marked safe" : "Cancelled"}
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{isOwner ? "Your emergency alert" : `${event.userName} needs help`}</h1>
            <p className="mt-1 text-sm opacity-80">{TRIGGER_LABEL[event.trigger]} · {formatDateTime(event.createdAt)} · ID {event.id.slice(-8)}</p>
          </div>
          <Button asChild variant="light" size="lg"><a href="tel:112"><Phone /> Call 112</a></Button>
        </div>
        {event.note && <p className="mt-4 rounded-xl bg-white/10 p-3 text-sm">{event.note}</p>}
      </div>

      {/* Contact's response actions */}
      {!isOwner && myResponse && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Your response</p>
              <ResponseStatusBadge status={myResponse.status} />
            </div>
            {active && myResponse.status !== "acknowledged" && myResponse.status !== "declined" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="accent" size="lg" loading={busy === "ack"} onClick={() => act("ack", () => api(`/api/emergencies/${id}/respond`, { body: { action: "acknowledge" } }), `${event.userName.split(" ")[0]} has been told you're responding`)}>
                  <CheckCircle2 /> I&apos;m responding
                </Button>
                <Button variant="outline" size="lg" loading={busy === "dec"} onClick={() => act("dec", () => api(`/api/emergencies/${id}/respond`, { body: { action: "decline" } }), "Response recorded. Others are still being alerted.")}>
                  I can&apos;t help right now
                </Button>
              </div>
            )}
            {myResponse.status === "acknowledged" && active && (
              <Alert tone="success">You acknowledged this alert. Try to reach {event.userName.split(" ")[0]} directly, and call 112 if you believe they are in danger.</Alert>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{isOwner ? "Who has been alerted" : "Response status"}</CardTitle>
            <button onClick={reload} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Refresh"><RefreshCw className="size-4" /></button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              <Stat label="Alerted" value={summary.total} />
              <Stat label="Acknowledged" value={summary.acknowledged} tone="text-success" />
              <Stat label="Awaiting" value={summary.awaiting} tone="text-warning" />
              <Stat label="Failed" value={summary.failed} tone={summary.failed ? "text-emergency" : undefined} />
            </div>
            {isOwner && active && escalation && (
              <p className="flex items-center gap-2 rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
                <Clock className="size-3.5 shrink-0" />
                {escalation.reason === "waiting" && `Secondary contacts will be alerted in ${escalation.secondsRemaining}s if no primary contact acknowledges.`}
                {escalation.reason === "primary_acknowledged" && "A primary contact acknowledged, so escalation is not needed."}
                {escalation.reason === "already_escalated" && "Escalated: secondary contacts have been alerted."}
                {escalation.reason === "no_secondary_contacts" && "No secondary contacts left to escalate to."}
                {escalation.reason === "disabled" && "Escalation is turned off in your SOS settings."}
              </p>
            )}
            {responses.length === 0 ? (
              <Alert tone="warning" title="No one could be alerted">You have no accepted trusted contacts. Call 112 or someone you trust directly. <Link href="/circle" className="font-semibold underline">Add contacts</Link></Alert>
            ) : (
              <ResponseList responses={responses} showHistory={isOwner} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="size-4 text-accent" />Shared location</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {event.location ? <LocationMap point={event.location} label={`${event.userName}'s location`} /> : (
                <p className="text-sm text-muted-foreground">{isOwner ? "No location was attached to this alert." : "Location was not available or not shared."}</p>
              )}
              {isOwner && active && (
                <Button variant="outline" className="w-full" loading={busy === "loc"} onClick={() => act("loc", async () => {
                  const p = await getCurrent();
                  if (!p) throw new Error("Location unavailable. Check browser permission.");
                  await api(`/api/emergencies/${id}/location`, { body: { location: p } });
                }, "Location updated for your contacts")}>
                  <MapPin /> Update my location
                </Button>
              )}
              {!isOwner && event.location && <p className="text-xs text-muted-foreground">Last updated {timeAgo(event.location.capturedAt)}.</p>}
            </CardContent>
          </Card>

          {isOwner && active && (
            <Card>
              <CardContent className="space-y-2 p-5">
                <Button variant="accent" size="lg" className="w-full" loading={busy === "resolve"} onClick={() => act("resolve", () => api(`/api/emergencies/${id}`, { method: "PATCH", body: { action: "resolve" } }), "Marked safe. Your contacts have been told.")}>
                  <ShieldCheck /> I&apos;m safe now
                </Button>
                <Button variant="ghost" className="w-full" loading={busy === "cancel"} onClick={() => act("cancel", () => api(`/api/emergencies/${id}`, { method: "PATCH", body: { action: "cancel" } }), "Alert cancelled. Contacts notified it was a false alarm.")}>
                  Cancel: it was a false alarm
                </Button>
              </CardContent>
            </Card>
          )}
          {!active && (
            <div className="space-y-2">
              <Badge tone="neutral" className="w-full justify-center py-2">Closed {formatDateTime(event.resolvedAt ?? event.cancelledAt)}</Badge>
              {event.viewerAccessExpiresAt && (
                <p className="text-center text-xs text-muted-foreground">
                  {isOwner
                    ? new Date(event.viewerAccessExpiresAt) > new Date()
                      ? `Your contacts can view this emergency until ${formatDateTime(event.viewerAccessExpiresAt)}. After that, only you can.`
                      : "Your contacts' access to this emergency has ended. Only you can view it."
                    : `Your access to this emergency ends ${formatDateTime(event.viewerAccessExpiresAt)}.`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
