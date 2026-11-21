import type { Metadata } from "next";
import { PageHero } from "@/components/layout/page-hero";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About SafeHer" title="Help shouldn't depend on how many calls you can make">
        SafeHer is a social-impact project building an integrated personal safety and emergency response ecosystem.
      </PageHero>
      <section className="container max-w-3xl space-y-10 py-16">
        <div>
          <h2 className="text-2xl font-bold">The problem</h2>
          <p className="mt-3 text-muted-foreground">
            In a frightening moment, most safety apps still leave a woman doing the coordination herself: calling one person, then another,
            explaining where she is, hoping someone picks up. Every second spent dialling is a second not spent getting safe.
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-bold">Our approach</h2>
          <p className="mt-3 text-muted-foreground">
            SafeHer is designed around one principle: <strong className="text-foreground">one emergency trigger should initiate a coordinated safety response.</strong>{" "}
            Your trusted circle is alerted together, sees what you&apos;ve chosen to share, and the system escalates on its own if no one responds.
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-bold">What we won&apos;t do</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>Pretend to be an emergency service or claim police integration we don&apos;t have.</li>
            <li>Track location or listen to the microphone without clear, revocable consent.</li>
            <li>Show an alert as delivered or acknowledged before it truly is.</li>
            <li>Claim background voice detection works where the platform doesn&apos;t allow it.</li>
          </ul>
        </div>
        <div>
          <h2 className="text-2xl font-bold">Roadmap</h2>
          <p className="mt-3 text-muted-foreground">
            The web app is the first target. Next come a verified community helper network, in-app group voice rooms, a secure evidence
            vault and a community safety map, followed by native Android and iOS apps that share the same backend, with on-device
            voice-activated SOS.
          </p>
        </div>
      </section>
    </>
  );
}
