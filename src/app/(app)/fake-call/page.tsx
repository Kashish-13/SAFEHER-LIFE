"use client";

import { Info, Mic, MicOff, Phone, PhoneOff, Smartphone, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { playRingtone, type Ringtone } from "@/lib/ringtone";
import { initials } from "@/lib/utils";

type Phase = "setup" | "scheduled" | "ringing" | "in_call";

/**
 * Fake Call / Escape mode. This is a SIMULATED call screen rendered by the
 * web app. It's not a real phone call, and the page must stay open for it to ring.
 */
export default function FakeCallPage() {
  const [caller, setCaller] = useState("Mom");
  const [delay, setDelay] = useState(10);
  const [ringtone, setRingtone] = useState<Ringtone>("marimba");
  const [phase, setPhase] = useState<Phase>("setup");
  const [remaining, setRemaining] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const stopRing = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (phase !== "scheduled") return;
    if (remaining <= 0) { setPhase("ringing"); return; }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, remaining]);

  useEffect(() => {
    if (phase !== "ringing") return;
    try { stopRing.current = playRingtone(ringtone); } catch { /* audio blocked */ }
    if ("vibrate" in navigator) navigator.vibrate?.([800, 400, 800, 400, 800]);
    return () => { stopRing.current?.(); stopRing.current = null; navigator.vibrate?.(0); };
  }, [phase, ringtone]);

  useEffect(() => {
    if (phase !== "in_call") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const end = () => setPhase("setup");

  if (phase === "ringing" || phase === "in_call") {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col items-center justify-between bg-gradient-to-b from-[#1b1a3f] via-[#111029] to-black px-6 pb-16 pt-24 text-white">
        <div className="text-center">
          <span className="mx-auto grid size-28 place-items-center rounded-full bg-white/10 text-4xl font-semibold">{initials(caller)}</span>
          <p className="mt-6 text-3xl font-semibold">{caller}</p>
          <p className="mt-2 text-white/60">{phase === "ringing" ? "mobile · incoming call" : `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`}</p>
        </div>
        {phase === "ringing" ? (
          <div className="flex w-full max-w-xs justify-between">
            <button onClick={end} className="flex flex-col items-center gap-2" aria-label="Decline"><span className="grid size-16 place-items-center rounded-full bg-red-500"><PhoneOff className="size-7" /></span><span className="text-sm">Decline</span></button>
            <button onClick={() => setPhase("in_call")} className="flex flex-col items-center gap-2" aria-label="Accept"><span className="grid size-16 animate-bounce place-items-center rounded-full bg-green-500"><Phone className="size-7" /></span><span className="text-sm">Accept</span></button>
          </div>
        ) : (
          <div className="space-y-10">
            <div className="grid grid-cols-3 gap-8">
              <button onClick={() => setMuted(!muted)} className="flex flex-col items-center gap-2 text-sm"><span className={`grid size-16 place-items-center rounded-full ${muted ? "bg-white text-black" : "bg-white/15"}`}>{muted ? <MicOff /> : <Mic />}</span>Mute</button>
              <span className="flex flex-col items-center gap-2 text-sm"><span className="grid size-16 place-items-center rounded-full bg-white/15"><Volume2 /></span>Speaker</span>
              <span className="flex flex-col items-center gap-2 text-sm"><span className="grid size-16 place-items-center rounded-full bg-white/15"><Smartphone /></span>Keypad</span>
            </div>
            <button onClick={end} className="mx-auto grid size-16 place-items-center rounded-full bg-red-500" aria-label="End call"><PhoneOff className="size-7" /></button>
          </div>
        )}
        <p className="text-[10px] text-white/30">Simulated call · SafeHer</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Fake call" description="Schedule a realistic incoming call to help you leave an uncomfortable situation." />
      <Alert tone="neutral" title="This is a simulated call"><span className="flex gap-1.5"><Info className="mt-0.5 size-3.5 shrink-0" />It&apos;s a screen shown by SafeHer, not a real phone call. Nobody is dialled. Keep this page open (screen on) for it to ring.</span></Alert>
      <Card>
        <CardHeader><CardTitle>Set up your call</CardTitle></CardHeader>
        <CardContent>
          {phase === "scheduled" ? (
            <div className="space-y-4 text-center">
              <p className="font-display text-5xl font-bold tabular-nums">{remaining}s</p>
              <p className="text-muted-foreground">{caller} will &quot;call&quot; you shortly. Keep this page open and your screen on.</p>
              <Button variant="outline" onClick={end}>Cancel</Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setRemaining(delay); setPhase(delay === 0 ? "ringing" : "scheduled"); }}>
              <Field id="caller" label="Caller name"><Input id="caller" value={caller} onChange={(e) => setCaller(e.target.value)} maxLength={30} required /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="delay" label="Ring in">
                  <Select id="delay" value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
                    {[[0, "Now"], [10, "10 seconds"], [30, "30 seconds"], [60, "1 minute"], [300, "5 minutes"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
                <Field id="ring" label="Ringtone">
                  <Select id="ring" value={ringtone} onChange={(e) => setRingtone(e.target.value as Ringtone)}>
                    <option value="marimba">Marimba</option><option value="classic">Classic</option><option value="pulse">Pulse</option>
                  </Select>
                </Field>
              </div>
              <Button type="submit" size="lg" className="w-full"><Phone />Schedule call</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
