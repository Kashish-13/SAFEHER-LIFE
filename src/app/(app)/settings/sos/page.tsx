"use client";

import { useState } from "react";
import type { EmergencyCircle, EmergencyPreferences, UserProfile } from "@/core/types";
import { PageHeader } from "@/components/layout/page-header";
import { SettingRow } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";

export default function SosSettingsPage() {
  const { profile, setProfile } = useAuth();
  const toast = useToast();
  const circles = useApi<{ circles: EmergencyCircle[] }>("/api/circles");
  const [p, setP] = useState<EmergencyPreferences>(profile!.emergencyPreferences);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(p) !== JSON.stringify(profile!.emergencyPreferences);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ profile: UserProfile }>("/api/me/settings", { method: "PUT", body: { emergencyPreferences: p } });
      setProfile(r.profile); toast("SOS settings saved");
    } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="SOS settings" description="Control what happens when you trigger an emergency." />
      <Card>
        <CardHeader><CardTitle>Activation</CardTitle></CardHeader>
        <CardContent className="divide-y pt-0">
          <SettingRow id="confirm" title="Ask for confirmation" description="Show a confirmation step before the countdown begins." control={<Switch id="confirm" checked={p.confirmBeforeSOS} onCheckedChange={(v) => setP({ ...p, confirmBeforeSOS: v })} />} />
          <SettingRow id="cw" title="Cancel window" description="Countdown during which you can cancel before alerts are sent." control={
            <Select id="cw" className="w-40" value={p.cancelWindowSeconds} onChange={(e) => setP({ ...p, cancelWindowSeconds: Number(e.target.value) })}>
              {[0, 3, 5, 10, 15].map((s) => <option key={s} value={s}>{s === 0 ? "None (instant)" : `${s} seconds`}</option>)}
            </Select>} />
          <SettingRow id="loc" title="Share location with alerts" description="Attach your current location (if available) for the contacts alerted." control={<Switch id="loc" checked={p.shareLocationOnSOS} onCheckedChange={(v) => setP({ ...p, shareLocationOnSOS: v })} />} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Who gets alerted</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Choose circles to alert. With none selected, all accepted contacts are included. Primary contacts are always alerted first.</p>
          {(circles.data?.circles ?? []).map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 hover:bg-secondary/50">
              <input type="checkbox" className="size-4 accent-[hsl(var(--accent))]" checked={p.notifyCircleIds.includes(c.id)}
                onChange={(e) => setP({ ...p, notifyCircleIds: e.target.checked ? [...p.notifyCircleIds, c.id] : p.notifyCircleIds.filter((x) => x !== c.id) })} />
              <span className="text-sm"><strong>{c.name}</strong> <span className="text-muted-foreground">· {c.contactIds.length} members</span></span>
            </label>
          ))}
          {circles.data?.circles.length === 0 && <p className="text-sm text-muted-foreground">No circles yet. All accepted contacts will be alerted.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Smart escalation</CardTitle></CardHeader>
        <CardContent className="divide-y pt-0">
          <SettingRow id="esc" title="Escalate to secondary contacts" description="If no primary contact acknowledges in time, alert secondary contacts automatically (once)." control={<Switch id="esc" checked={p.escalation.enabled} onCheckedChange={(v) => setP({ ...p, escalation: { ...p.escalation, enabled: v } })} />} />
          <SettingRow id="esct" title="Wait before escalating" control={
            <Select id="esct" className="w-40" disabled={!p.escalation.enabled} value={p.escalation.primaryTimeoutSeconds} onChange={(e) => setP({ ...p, escalation: { ...p.escalation, primaryTimeoutSeconds: Number(e.target.value) } })}>
              {[30, 60, 120, 180, 300, 600].map((s) => <option key={s} value={s}>{s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? "s" : ""}`}</option>)}
            </Select>} />
        </CardContent>
      </Card>

      <div className="sticky bottom-24 flex justify-end lg:bottom-6">
        <Button size="lg" onClick={save} loading={busy} disabled={!dirty} className="shadow-lg">Save changes</Button>
      </div>
    </div>
  );
}
