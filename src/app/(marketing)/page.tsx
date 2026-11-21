import { ArrowRight, BellRing, Check, CheckCheck, Lock, MapPin, ShieldCheck, Siren, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import { AVAILABILITY_LABEL, FEATURES } from "@/content/features";
import { cn } from "@/lib/utils";

function PhoneMock() {
  const rows = [
    { name: "Mother", status: "Acknowledged", icon: CheckCheck, tone: "text-teal-300" },
    { name: "Father", status: "Delivered", icon: Check, tone: "text-white/80" },
    { name: "Meera (friend)", status: "Waiting · escalates in 0:42", icon: BellRing, tone: "text-amber-300" },
  ];
  return (
    <div className="relative mx-auto w-[300px] sm:w-[320px]" aria-hidden>
      <div className="absolute -inset-10 rounded-full bg-teal-400/10 blur-3xl" />
      <div className="relative rounded-[2.6rem] border border-white/15 bg-navy-900 p-3 shadow-2xl">
        <div className="rounded-[2rem] bg-gradient-to-b from-[#1d1b4d] to-navy-950 p-5">
          <div className="flex items-center justify-between text-[11px] text-white/50"><span>9:41</span><span>SafeHer</span></div>
          <div className="mt-6 flex flex-col items-center">
            <div className="relative grid size-36 place-items-center">
              <span className="absolute inset-0 animate-pulse-ring rounded-full bg-red-500/30" />
              <span className="absolute inset-3 animate-pulse-ring rounded-full bg-red-500/20 [animation-delay:0.6s]" />
              <div className="relative grid size-28 place-items-center rounded-full bg-gradient-to-b from-red-500 to-red-600 shadow-[0_10px_40px_rgba(239,68,68,0.5)]">
                <div className="text-center text-white"><Siren className="mx-auto size-7" /><p className="mt-1 text-lg font-extrabold tracking-wider">SOS</p></div>
              </div>
            </div>
            <p className="mt-4 text-sm font-semibold text-white">Emergency alert active</p>
            <p className="text-xs text-white/50">Location shared · 3 contacts alerted at once</p>
          </div>
          <div className="mt-5 space-y-2">
            {rows.map((r) => (
              <div key={r.name} className="flex items-center justify-between rounded-xl bg-white/[0.06] px-3 py-2.5">
                <span className="text-xs font-medium text-white">{r.name}</span>
                <span className={cn("flex items-center gap-1 text-[11px] font-semibold", r.tone)}><r.icon className="size-3.5" />{r.status}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/10 py-2.5 text-center text-xs font-semibold text-white">I&apos;m safe</div>
            <div className="rounded-xl bg-red-500 py-2.5 text-center text-xs font-semibold text-white">Call 112</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: Siren, title: "Trigger once", body: "Press SOS, or (in the native app) say your phrase. A cancel window guards against accidents." },
  { icon: Users, title: "Your circle is alerted together", body: "Every primary contact gets your alert, time and authorised location simultaneously." },
  { icon: BellRing, title: "Escalates if nobody responds", body: "No acknowledgement in time? Secondary contacts are alerted, exactly once. In this version the check runs while your emergency screen is open; fully server-side scheduling is in development." },
  { icon: ShieldCheck, title: "Coordinate until you're safe", body: "See who has acknowledged, share live location, call 112, then mark yourself safe." },
];

export default function LandingPage() {
  return (
    <>
      <section className="hero-gradient relative overflow-hidden text-white">
        <div className="grid-fade absolute inset-0" aria-hidden />
        <div className="container relative grid items-center gap-14 py-16 md:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <Badge className="bg-white/10 text-teal-200"><ShieldCheck /> Emergency response, coordinated</Badge>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] sm:text-5xl lg:text-6xl">
              One trigger.<br />
              <span className="bg-gradient-to-r from-teal-300 to-violet-300 bg-clip-text text-transparent">Your whole circle responds.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/70">
              SafeHer turns a single SOS into a coordinated response: your trusted family and friends are alerted at once, see your location
              with your consent, and secondary contacts can be alerted if no one answers.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="accent"><Link href="/signup">Create your safety circle <ArrowRight /></Link></Button>
              <Button asChild size="lg" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10"><Link href="/how-it-works">See how it works</Link></Button>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
              <li className="flex items-center gap-2"><Lock className="size-4 text-teal-300" /> Consent-based location</li>
              <li className="flex items-center gap-2"><CheckCheck className="size-4 text-teal-300" /> Honest delivery status</li>
              <li className="flex items-center gap-2"><MapPin className="size-4 text-teal-300" /> No hidden tracking</li>
            </ul>
          </div>
          <PhoneMock />
        </div>
      </section>

      <section className="container py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">How SafeHer responds</p>
          <h2 className="mt-2 text-3xl font-bold sm:text-4xl">In an emergency, you shouldn&apos;t have to call five people.</h2>
        </div>
        <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-2xl border bg-card p-6 shadow-soft">
              <span className="absolute right-5 top-5 font-display text-4xl font-extrabold text-secondary">{i + 1}</span>
              <div className="grid size-11 place-items-center rounded-xl bg-primary text-white"><s.icon className="size-5" /></div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-secondary/50 py-20">
        <div className="container">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-accent">An integrated safety ecosystem</p>
              <h2 className="mt-2 text-3xl font-bold sm:text-4xl">Everything around the SOS, too.</h2>
            </div>
            <p className="max-w-md text-sm text-muted-foreground">Each feature is labelled with its real availability. We never present something as working when it isn&apos;t.</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.slice(0, 9).map((f) => (
              <div key={f.title} className="rounded-2xl border bg-card p-6 shadow-soft">
                <div className="flex items-start justify-between">
                  <div className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent"><f.icon className="size-5" /></div>
                  <Badge tone={f.availability === "web" ? "success" : f.availability === "mobile" ? "primary" : "neutral"}>{AVAILABILITY_LABEL[f.availability]}</Badge>
                </div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center"><Button asChild variant="outline"><Link href="/features">All features <ArrowRight /></Link></Button></div>
        </div>
      </section>

      <section className="container py-20">
        <div className="grid gap-10 rounded-3xl bg-primary p-8 text-white md:grid-cols-2 md:p-14">
          <div>
            <h2 className="text-3xl font-bold">Built on consent, not surveillance.</h2>
            <p className="mt-3 text-white/70">Your location is shared only with people you choose, only when you choose, and you can revoke it instantly. Helpers never see your exact position. Admins never see your location.</p>
            <Button asChild variant="light" className="mt-6"><Link href="/privacy-safety">Our privacy commitments</Link></Button>
          </div>
          <ul className="space-y-3 text-sm">
            {[
              "No background microphone or location monitoring without explicit opt-in",
              "Voice detection runs on-device in the native app; raw audio is never uploaded",
              "Delivery status is shown only after the system confirms it",
              "SafeHer is not police dispatch. Call 112 is always one tap away",
              "Delete your account and data at any time",
            ].map((t) => (
              <li key={t} className="flex gap-3 rounded-xl bg-white/5 p-3.5"><Check className="mt-0.5 size-4 shrink-0 text-teal-300" />{t}</li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
