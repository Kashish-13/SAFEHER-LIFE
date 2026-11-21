"use client";

import { ArrowLeft, ArrowRight, Bell, Check, MapPin, Mic, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { UserProfile } from "@/core/types";
import { PhoneVerify } from "@/components/auth/phone-verify";
import { Logo } from "@/components/brand/logo";
import { ContactFormDialog } from "@/components/circle/contact-form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, Badge, Spinner } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const STEPS = ["Profile", "Phone", "Permissions", "SOS preferences", "Trusted contact"];
const LANGUAGES = [["en", "English"], ["hi", "हिन्दी"], ["bn", "বাংলা"], ["ta", "தமிழ்"], ["te", "తెలుగు"], ["mr", "मराठी"], ["kn", "ಕನ್ನಡ"], ["ml", "മലയാളം"], ["gu", "ગુજરાતી"], ["pa", "ਪੰਜਾਬੀ"]];

function PermissionRow({ icon: Icon, title, why, state, onRequest }: { icon: typeof Bell; title: string; why: string; state: string; onRequest?: () => void }) {
  return (
    <div className="flex gap-3 rounded-xl border p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Icon className="size-5" /></div>
      <div className="flex-1">
        <p className="flex items-center gap-2 font-semibold">{title} <Badge tone={state === "granted" ? "success" : state === "denied" ? "emergency" : "neutral"} className="capitalize">{state}</Badge></p>
        <p className="mt-0.5 text-sm text-muted-foreground">{why}</p>
        {onRequest && state !== "granted" && state !== "unsupported" && <Button size="sm" variant="outline" className="mt-2" onClick={onRequest}>Allow</Button>}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const { status, profile, setProfile } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [language, setLanguage] = useState("en");
  const [cancelWindow, setCancelWindow] = useState(5);
  const [shareLoc, setShareLoc] = useState(true);
  const [confirmSos, setConfirmSos] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactAdded, setContactAdded] = useState(false);
  const [perm, setPerm] = useState({ location: "not asked", notifications: "not asked" });

  useEffect(() => {
    if (status === "signed_out") router.replace("/login");
    if (profile) { setFullName(profile.fullName); setLanguage(profile.language); }
  }, [status, profile, router]);

  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((s) => setPerm((p) => ({ ...p, location: s.state }))).catch(() => {});
    if ("Notification" in window) setPerm((p) => ({ ...p, notifications: Notification.permission === "default" ? "not asked" : Notification.permission }));
    else setPerm((p) => ({ ...p, notifications: "unsupported" }));
  }, []);

  if (!profile) return <div className="grid min-h-screen place-items-center"><Spinner className="size-8" /></div>;

  const next = async () => {
    setError(null); setBusy(true);
    try {
      if (step === 0) {
        if (!fullName.trim()) throw new Error("Please enter your name");
        const { profile: p } = await api<{ profile: UserProfile }>("/api/me", { method: "PATCH", body: { fullName, language } });
        setProfile(p);
      }
      if (step === 3) {
        await api("/api/me/settings", { method: "PUT", body: { emergencyPreferences: { ...profile.emergencyPreferences, cancelWindowSeconds: cancelWindow, shareLocationOnSOS: shareLoc, confirmBeforeSOS: confirmSos } } });
      }
      if (step === STEPS.length - 1) {
        const { profile: p } = await api<{ profile: UserProfile }>("/api/me", { method: "PATCH", body: { onboardingComplete: true } });
        setProfile(p);
        router.replace("/dashboard");
        return;
      }
      setStep((s) => s + 1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-secondary/40 px-4 py-8">
      <div className="mx-auto max-w-xl">
        <Logo />
        <ol className="my-8 flex gap-1.5" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <div className={cn("h-1.5 rounded-full", i <= step ? "bg-accent" : "bg-border")} />
              <p className={cn("mt-1.5 hidden text-[11px] sm:block", i === step ? "font-semibold text-foreground" : "text-muted-foreground")}>{s}</p>
            </li>
          ))}
        </ol>

        <Card>
          <CardContent className="space-y-5 p-6">
            {step === 0 && (
              <>
                <div><h1 className="text-2xl font-bold">Welcome to SafeHer</h1><p className="text-muted-foreground">Let&apos;s set up your safety profile.</p></div>
                <Field id="fullName" label="Full name"><Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} autoComplete="name" /></Field>
                <Field id="language" label="Preferred language" hint="Full translations are on the roadmap; your preference is saved now.">
                  <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                </Field>
              </>
            )}
            {step === 1 && (
              <>
                <div><h1 className="text-2xl font-bold">Verify your phone</h1><p className="text-muted-foreground">Optional, but it helps contacts trust alerts come from you.</p></div>
                <PhoneVerify />
              </>
            )}
            {step === 2 && (
              <>
                <div><h1 className="text-2xl font-bold">Permissions, explained</h1><p className="text-muted-foreground">SafeHer asks only for what each feature needs, only when you use it. You can change these anytime in your browser settings.</p></div>
                <PermissionRow icon={MapPin} title="Location" state={perm.location}
                  why="Attached to an SOS and shared with people you choose. Read only while SafeHer is open; never in the background on the web."
                  onRequest={() => navigator.geolocation.getCurrentPosition(() => setPerm((p) => ({ ...p, location: "granted" })), () => setPerm((p) => ({ ...p, location: "denied" })))} />
                <PermissionRow icon={Bell} title="Notifications" state={perm.notifications}
                  why="So you can receive alerts when someone in your circle needs help."
                  onRequest={() => Notification.requestPermission().then((r) => setPerm((p) => ({ ...p, notifications: r === "default" ? "not asked" : r })))} />
                <PermissionRow icon={Mic} title="Microphone" state="asked later"
                  why="Only for the Voice SOS test you start yourself. Not requested now. Background voice detection is a native-app feature with its own consent." />
              </>
            )}
            {step === 3 && (
              <>
                <div><h1 className="text-2xl font-bold">SOS preferences</h1><p className="text-muted-foreground">How should SOS behave when you press it?</p></div>
                <Field id="cw" label="Cancel window" hint="Time to cancel an accidental press before alerts go out.">
                  <Select id="cw" value={cancelWindow} onChange={(e) => setCancelWindow(Number(e.target.value))}>
                    {[0, 3, 5, 10].map((s) => <option key={s} value={s}>{s === 0 ? "Send immediately" : `${s} seconds`}</option>)}
                  </Select>
                </Field>
                <div className="flex items-center justify-between rounded-xl border p-4"><label htmlFor="sl" className="text-sm"><strong>Share my location with alerts</strong><br /><span className="text-muted-foreground">Only with the contacts alerted.</span></label><Switch id="sl" checked={shareLoc} onCheckedChange={setShareLoc} /></div>
                <div className="flex items-center justify-between rounded-xl border p-4"><label htmlFor="cf" className="text-sm"><strong>Ask for confirmation</strong><br /><span className="text-muted-foreground">An extra tap before the countdown.</span></label><Switch id="cf" checked={confirmSos} onCheckedChange={setConfirmSos} /></div>
              </>
            )}
            {step === 4 && (
              <>
                <div><h1 className="text-2xl font-bold">Add your first trusted contact</h1><p className="text-muted-foreground">Who should know if you need help? You can add more later.</p></div>
                {contactAdded ? <Alert tone="success" title="Contact invited">They&apos;ll start receiving alerts once they accept.</Alert> : (
                  <Button variant="outline" className="h-20 w-full border-dashed" onClick={() => setContactOpen(true)}><UserPlus /> Add a trusted contact</Button>
                )}
              </>
            )}

            {error && <Alert tone="emergency">{error}</Alert>}
            <div className="flex justify-between gap-2 pt-2">
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0}><ArrowLeft /> Back</Button>
              <Button onClick={next} loading={busy}>
                {step === STEPS.length - 1 ? <><Check /> Finish</> : (step === 1 || step === 4) && !(step === 1 ? profile.phoneVerified : contactAdded) ? <>Skip <ArrowRight /></> : <>Continue <ArrowRight /></>}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <ContactFormDialog open={contactOpen} onClose={() => setContactOpen(false)} onCreated={() => setContactAdded(true)} />
    </div>
  );
}
