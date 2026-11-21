"use client";

import { ArrowRight, Car, HandHeart, History, MapPin, Mic, Phone, Smartphone, Users } from "lucide-react";
import Link from "next/link";
import type { EmergencyEvent, JourneySession, LocationSession, TrustedContact } from "@/core/types";
import type { JourneyState } from "@/core/journey";
import { TRIGGER_LABEL } from "@/components/emergency/labels";
import { SosButton } from "@/components/sos/sos-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/feedback";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { useSafetyStatus } from "@/hooks/use-safety-status";
import { formatDateTime, initials, timeAgo } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}


function StatCard({ href, icon: Icon, title, children, loading }: { href: string; icon: typeof Users; title: string; children: React.ReactNode; loading?: boolean }) {
  return (
    <Link href={href} className="group block">
      <Card className="h-full transition group-hover:border-accent/50 group-hover:shadow-md">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Icon className="size-4 text-accent" />{title}</CardTitle>
          <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
        </CardHeader>
        <CardContent>{loading ? <Skeleton className="h-10" /> : children}</CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const { incomingAlerts } = useSafetyStatus();
  const contacts = useApi<{ contacts: TrustedContact[] }>("/api/contacts");
  const sessions = useApi<{ sessions: (LocationSession & { effectiveStatus: string })[] }>("/api/location/sessions");
  const history = useApi<{ events: EmergencyEvent[] }>("/api/emergencies");
  const journeys = useApi<{ journeys: (JourneySession & { state: JourneyState })[] }>("/api/journeys");
  const incoming = useApi<{ incoming: { linkId: string; ownerName: string; relationship: string }[] }>("/api/contacts/incoming");

  const accepted = contacts.data?.contacts.filter((c) => c.status === "accepted") ?? [];
  const pending = contacts.data?.contacts.filter((c) => c.status === "pending") ?? [];
  const liveShares = sessions.data?.sessions.filter((s) => s.effectiveStatus === "active") ?? [];
  const activeJourney = journeys.data?.journeys.find((j) => j.status === "active");
  const first = profile!.fullName.split(" ")[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{greeting()}, {first}</h1>
        <p className="mt-1 text-muted-foreground">
          {accepted.length > 0 ? `${accepted.length} trusted ${accepted.length === 1 ? "contact is" : "contacts are"} ready to respond.` : "Add trusted contacts so SOS can reach someone."}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col items-center px-5 py-10">
            {contacts.data && accepted.length === 0 && (
              <div className="mb-6 w-full rounded-xl bg-warning-soft p-3 text-center text-sm text-[hsl(30_80%_28%)]">
                No accepted contacts yet. SOS will record the event, but no one can be alerted. <Link href="/circle" className="font-semibold underline">Add contacts</Link>
              </div>
            )}
            <SosButton />
            <div className="mt-10 grid w-full max-w-md grid-cols-3 gap-2">
              <Button asChild variant="outline" className="h-auto flex-col gap-1 py-3 text-emergency"><a href="tel:112"><Phone />Call 112</a></Button>
              <Button asChild variant="outline" className="h-auto flex-col gap-1 py-3"><Link href="/journey"><Car />Journey</Link></Button>
              <Button asChild variant="outline" className="h-auto flex-col gap-1 py-3"><Link href="/fake-call"><Smartphone />Fake call</Link></Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <StatCard href="/circle" icon={Users} title="Emergency circle" loading={contacts.loading}>
            <div className="flex -space-x-2">
              {accepted.slice(0, 5).map((c) => (
                <span key={c.id} title={c.name} className="grid size-9 place-items-center rounded-full bg-primary text-[11px] font-bold text-white ring-2 ring-card">{initials(c.name)}</span>
              ))}
            </div>
            <p className="mt-2 text-sm"><strong>{accepted.length}</strong> accepted{pending.length > 0 && <> · <span className="text-warning">{pending.length} pending</span></>}</p>
          </StatCard>

          <StatCard href="/location" icon={MapPin} title="Location sharing" loading={sessions.loading}>
            <p className="text-2xl font-bold">{liveShares.length}</p>
            <p className="text-sm text-muted-foreground">{liveShares.length ? `Sharing with ${liveShares.map((s) => s.contactName.split(" ")[0]).join(", ")}` : "Not sharing with anyone"}</p>
          </StatCard>

          <StatCard href="/settings/voice" icon={Mic} title="Voice SOS">
            {profile!.voiceSos.enabled ? (
              <><Badge tone="primary">Configured</Badge><p className="mt-2 text-sm text-muted-foreground">Phrase “{profile!.voiceSos.phrase}”. Background listening needs the native app.</p></>
            ) : (
              <><Badge>Off</Badge><p className="mt-2 text-sm text-muted-foreground">Set up your emergency phrase.</p></>
            )}
          </StatCard>

          <StatCard href="/journey" icon={Car} title="Safe Journey" loading={journeys.loading}>
            {activeJourney ? (
              <><Badge tone={activeJourney.state.kind === "ok" ? "success" : "warning"}>{activeJourney.state.kind === "ok" ? "In progress" : "Check-in due"}</Badge>
                <p className="mt-2 truncate text-sm">To {activeJourney.destination}</p></>
            ) : <p className="text-sm text-muted-foreground">No active journey. Share your trip before you travel.</p>}
          </StatCard>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2"><History className="size-4 text-accent" />Recent emergency activity</CardTitle>
            <Link href="/history" className="text-sm font-semibold text-accent">View all</Link>
          </CardHeader>
          <CardContent>
            {history.loading ? <Skeleton className="h-24" /> : (history.data?.events.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No emergencies recorded. We hope it stays that way.</p>
            ) : (
              <ul className="divide-y">
                {history.data!.events.slice(0, 3).map((e) => (
                  <li key={e.id}>
                    <Link href={`/emergency/${e.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80">
                      <div><p className="text-sm font-medium">{TRIGGER_LABEL[e.trigger]}</p><p className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</p></div>
                      <Badge tone={e.status === "active" ? "emergency" : e.status === "resolved" ? "success" : "neutral"} className="capitalize">{e.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><HandHeart className="size-4 text-accent" />People who trust you</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {incomingAlerts.length > 0 && incomingAlerts.map((a) => (
              <Link key={a.eventId} href={`/emergency/${a.eventId}`} className="flex items-center justify-between rounded-xl bg-emergency-soft p-3 text-sm font-semibold text-emergency">
                {a.fromName} triggered SOS {timeAgo(a.createdAt)} <ArrowRight className="size-4" />
              </Link>
            ))}
            {incoming.loading ? <Skeleton className="h-16" /> : (incoming.data?.incoming.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">When someone adds you to their emergency circle, they&apos;ll appear here.</p>
            ) : (
              <ul className="space-y-2">
                {incoming.data!.incoming.map((i) => (
                  <li key={i.linkId} className="flex items-center gap-3 text-sm">
                    <span className="grid size-8 place-items-center rounded-full bg-secondary text-[11px] font-bold text-primary">{initials(i.ownerName)}</span>
                    <span><strong>{i.ownerName}</strong> <span className="text-muted-foreground">· you&apos;re their {i.relationship.toLowerCase()}</span></span>
                  </li>
                ))}
              </ul>
            )}
            <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
              <strong className="text-foreground">Nearby verified helpers:</strong> coming in the next phase. Helpers will be opted-in, identity-checked
              community members. They are not police or professional responders.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
