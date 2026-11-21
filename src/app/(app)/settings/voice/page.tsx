"use client";

import { CheckCircle2, FlaskConical, Mic, MicOff, Smartphone, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { EmergencyEvent, UserProfile, VoiceSosSettings } from "@/core/types";
import { voiceSosSchema } from "@/core/validation";
import { PageHeader } from "@/components/layout/page-header";
import { SettingRow } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import { useMicTest } from "@/hooks/use-mic-test";
import { useSafetyStatus } from "@/hooks/use-safety-status";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const PLATFORM = [
  { where: "Web (this app)", what: "Configure phrase · test mic while page is open · simulated trigger", ok: "partial" },
  { where: "Android native app (planned)", what: "On-device keyword spotting in a foreground service with a persistent notification. Works with screen locked, subject to OS battery limits.", ok: "planned" },
  { where: "iOS native app (planned)", what: "iOS heavily restricts background microphone access; expected to be limited to foreground or Siri Shortcuts.", ok: "limited" },
];

function SimulatedTrigger({ seconds }: { seconds: number }) {
  const { mode } = useAuth();
  const { refresh } = useSafetyStatus();
  const router = useRouter();
  const toast = useToast();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (count === null) return;
    if (count <= 0) {
      setCount(null);
      api<{ event: EmergencyEvent }>("/api/emergencies", { body: { trigger: "voice_simulated", location: null } })
        .then(async ({ event }) => { await refresh(); router.push(`/emergency/${event.id}`); })
        .catch((e) => toast((e as Error).message, "error"));
      return;
    }
    const t = setTimeout(() => setCount((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [count, refresh, router, toast]);

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><FlaskConical className="size-4 text-accent" />Simulated voice trigger</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Runs the same backend emergency trigger the native app will call, with <code className="rounded bg-muted px-1">trigger: &quot;voice_simulated&quot;</code>.
          {mode === "demo"
            ? " In demo mode the fictional contacts receive labelled [SIMULATED] alerts."
            : " With real accounts this is a dry run: the event is recorded for you, but none of your contacts are alerted."}
        </p>
        {count !== null ? (
          <div className="flex items-center justify-between rounded-xl bg-warning-soft p-4" role="alert">
            <p className="text-sm font-semibold text-[hsl(30_80%_28%)]">“Phrase detected”. Simulated SOS in {count}s</p>
            <Button size="sm" variant="outline" onClick={() => { setCount(null); toast("False activation cancelled", "info"); }}><X />Cancel</Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setCount(seconds)}><FlaskConical />Run simulated trigger</Button>
        )}
        <p className="text-xs text-muted-foreground">The {seconds}s countdown is the false-activation window: the native app gives you this time to cancel an accidental voice trigger.</p>
      </CardContent>
    </Card>
  );
}

export default function VoiceSosPage() {
  const { profile, setProfile } = useAuth();
  const toast = useToast();
  const [v, setV] = useState<VoiceSosSettings>(profile!.voiceSos);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [speechConsent, setSpeechConsent] = useState(false);
  const mic = useMicTest(v.phrase);
  const dirty = JSON.stringify(v) !== JSON.stringify(profile!.voiceSos);

  const save = async () => {
    const parsed = voiceSosSchema.safeParse(v);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(null); setBusy(true);
    try {
      const r = await api<{ profile: UserProfile }>("/api/me/settings", { method: "PUT", body: { voiceSos: parsed.data } });
      setProfile(r.profile); toast("Voice SOS settings saved");
    } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Voice SOS" description="Trigger SOS by saying a personal emergency phrase." />

      <Alert tone="warning" title="What works where">
        Browsers cannot listen when a tab is closed or your phone is locked, so locked-screen voice detection needs the SafeHer native app.
        Background detection can never be fully guaranteed on any phone, so manual SOS always stays available.
      </Alert>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Smartphone className="size-4 text-accent" />Platform support</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {PLATFORM.map((p) => (
              <li key={p.where} className="flex items-start justify-between gap-3 py-3">
                <div><p className="text-sm font-medium">{p.where}</p><p className="text-xs text-muted-foreground">{p.what}</p></div>
                <Badge tone={p.ok === "partial" ? "accent" : p.ok === "planned" ? "primary" : "warning"} className="capitalize">{p.ok}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Your phrase</CardTitle></CardHeader>
        <CardContent className="divide-y pt-0">
          <SettingRow id="en" title="Enable Voice SOS" description="Saved to your account and used by the native app once installed." control={<Switch id="en" checked={v.enabled} onCheckedChange={(x) => setV({ ...v, enabled: x })} />} />
          <div className="py-4">
            <Field id="phrase" label="Emergency phrase" error={error} hint="Use 2–4 words you wouldn't say by accident. Avoid words common in your daily speech.">
              <Input id="phrase" value={v.phrase} maxLength={40} onChange={(e) => setV({ ...v, phrase: e.target.value })} />
            </Field>
          </div>
          <SettingRow id="sens" title="Sensitivity" description="Higher detects more easily but may cause more false triggers. Applied by native engines that support it." control={
            <div className="flex w-40 items-center gap-2">
              <input id="sens" type="range" min={0} max={1} step={0.1} value={v.sensitivity} onChange={(e) => setV({ ...v, sensitivity: Number(e.target.value) })} className="w-full accent-[hsl(var(--accent))]" />
              <span className="w-8 text-right text-sm tabular-nums">{Math.round(v.sensitivity * 100)}</span>
            </div>} />
          <SettingRow id="faw" title="False-activation window" description="Seconds to cancel after the phrase is detected." control={
            <Select id="faw" className="w-36" value={v.falseActivationWindowSeconds} onChange={(e) => setV({ ...v, falseActivationWindowSeconds: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30].map((s) => <option key={s} value={s}>{s} seconds</option>)}
            </Select>} />
        </CardContent>
      </Card>

      <Card className={cn(mic.active && "border-emergency")}>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Microphone test</CardTitle>
          {mic.active ? <Badge tone="emergency"><span className="size-2 animate-pulse rounded-full bg-emergency" />Microphone active</Badge> : <Badge><MicOff />Off</Badge>}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Checks that your microphone works. Audio levels are measured locally in your browser. Nothing is recorded or uploaded. The test stops when you press Stop or leave this page, and it does not trigger SOS.</p>
          <div className="h-3 overflow-hidden rounded-full bg-secondary" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mic.level * 100)}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-75" style={{ width: `${mic.level * 100}%` }} />
          </div>
          <div className="flex flex-wrap gap-2">
            {mic.active ? <Button variant="outline" onClick={mic.stop}><MicOff />Stop</Button> : <Button variant="outline" onClick={mic.start}><Mic />Start mic test</Button>}
          </div>
          {mic.active && mic.speechSupported && (
            <div className="space-y-3 rounded-xl border p-4">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={speechConsent} onChange={(e) => setSpeechConsent(e.target.checked)} />
                <span>I understand the phrase test uses my browser&apos;s speech recognition, which in some browsers (e.g. Chrome) sends audio to the browser vendor&apos;s servers. The native app will detect phrases on-device.</span>
              </label>
              <Button size="sm" disabled={!speechConsent || mic.listening} onClick={mic.listenForPhrase}>{mic.listening ? "Listening for your phrase…" : "Test my phrase"}</Button>
              {mic.transcript && <p className="text-xs text-muted-foreground">Heard: “{mic.transcript}”</p>}
              {mic.detected && <Alert tone="success" title="Phrase recognised"><span className="flex items-center gap-1"><CheckCircle2 className="size-3.5" />“{v.phrase}” was detected. In the native app this would start the SOS countdown.</span></Alert>}
            </div>
          )}
          {mic.error && <Alert tone="emergency">{mic.error}</Alert>}
        </CardContent>
      </Card>

      <SimulatedTrigger seconds={v.falseActivationWindowSeconds} />

      <div className="sticky bottom-24 flex justify-end lg:bottom-6">
        <Button size="lg" onClick={save} loading={busy} disabled={!dirty} className="shadow-lg">Save changes</Button>
      </div>
    </div>
  );
}
