"use client";

import { Eye, MapPin, Mic, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { PrivacySettings, UserProfile } from "@/core/types";
import { PageHeader } from "@/components/layout/page-header";
import { SettingRow } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";

export default function PrivacySettingsPage() {
  const { profile, setProfile } = useAuth();
  const toast = useToast();
  const [p, setP] = useState<PrivacySettings>(profile!.privacy);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(p) !== JSON.stringify(profile!.privacy);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Privacy" description="Control who can see what, and how long SafeHer keeps it." />

      <Card>
        <CardHeader><CardTitle>Who can see your data</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {[
            { icon: MapPin, t: "Live location", d: "Only contacts you've explicitly shared with, while the share is active.", href: "/location" },
            { icon: Eye, t: "Emergency details", d: "Only you and the contacts alerted for that specific emergency.", href: "/history" },
            { icon: ShieldCheck, t: "Administrators", d: "Redacted activity only. Never your location, notes or contacts." },
            { icon: Mic, t: "Microphone", d: "Only during a test you start. Never recorded or uploaded by SafeHer.", href: "/settings/voice" },
          ].map((x) => {
            const inner = (<><x.icon className="size-5 text-accent" /><p className="mt-2 font-medium">{x.t}</p><p className="text-sm text-muted-foreground">{x.d}</p></>);
            return x.href ? <Link key={x.t} href={x.href} className="rounded-xl border p-4 hover:bg-secondary/50">{inner}</Link> : <div key={x.t} className="rounded-xl border p-4">{inner}</div>;
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Preferences</CardTitle></CardHeader>
        <CardContent className="divide-y pt-0">
          <SettingRow id="helpers" title="Allow nearby helper requests" description="When the helper network launches, verified helpers may receive your approximate distance (never exact location) only when you request help."
            control={<Switch id="helpers" checked={p.allowHelperRequests} onCheckedChange={(v) => setP({ ...p, allowHelperRequests: v })} />} />
          <SettingRow id="ret" title="Emergency history retention" description="Older events are deleted automatically by the scheduled retention job."
            control={<Select id="ret" className="w-40" value={p.historyRetentionDays} onChange={(e) => setP({ ...p, historyRetentionDays: Number(e.target.value) })}>
              {[[30, "30 days"], [90, "90 days"], [365, "1 year"], [0, "Until I delete"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>} />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" disabled={!dirty} loading={busy} onClick={async () => {
          setBusy(true);
          try { const r = await api<{ profile: UserProfile }>("/api/me/settings", { method: "PUT", body: { privacy: p } }); setProfile(r.profile); toast("Privacy settings saved"); }
          catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
        }}>Save changes</Button>
      </div>
    </div>
  );
}
