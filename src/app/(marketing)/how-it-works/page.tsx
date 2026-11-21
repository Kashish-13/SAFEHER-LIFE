import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "How it works" };

const FLOW = [
  { t: "0s", title: "You trigger SOS", body: "Press and confirm the SOS button. A configurable countdown (default 5 seconds) lets you cancel an accidental press before anything is sent." },
  { t: "1s", title: "An emergency event is created", body: "SafeHer records the time, your trigger type and, if you've allowed it, your latest location from your device." },
  { t: "1s", title: "Primary contacts are alerted simultaneously", body: "Every accepted primary contact receives an in-app alert (and a push notification where configured) at the same moment. No one-by-one calling." },
  { t: "live", title: "You see real delivery status", body: "Each contact moves through Sent → Delivered → Acknowledged, and each step appears only once the relevant system confirms it." },
  { t: "2 min", title: "Escalation if nobody acknowledges", body: "If no primary contact acknowledges within your configured window, secondary contacts are alerted automatically, exactly once." },
  { t: "end", title: "You mark yourself safe", body: "Resolve or cancel the emergency. Everyone alerted is told immediately, and the event is saved to your private history." },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHero eyebrow="How it works" title="From one tap to a coordinated response" />
      <section className="container max-w-3xl py-16">
        <ol className="relative space-y-8 border-l-2 border-secondary pl-8">
          {FLOW.map((s) => (
            <li key={s.title} className="relative">
              <span className="absolute -left-[45px] top-0 grid size-8 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">{s.t}</span>
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <p className="mt-1 text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-16 rounded-2xl border bg-card p-6 shadow-soft">
          <h2 className="text-lg font-semibold">About voice-activated SOS</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Web browsers cannot listen to the microphone when a tab is closed or the phone is locked, so locked-screen voice detection will ship
            in the native Android app. It uses on-device keyword spotting in a foreground service with a visible notification, and never
            uploads raw audio. In the web app you can configure your phrase, test your microphone while the page is open, and run a clearly
            labelled simulated trigger. Even on Android, OS battery restrictions mean background detection can never be guaranteed, so manual
            SOS always remains available.
          </p>
        </div>
        <div className="mt-10 text-center"><Button asChild size="lg"><Link href="/signup">Set up your circle <ArrowRight /></Link></Button></div>
      </section>
    </>
  );
}
