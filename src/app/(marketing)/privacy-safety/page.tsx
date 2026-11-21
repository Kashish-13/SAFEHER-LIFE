import type { Metadata } from "next";
import { PageHero } from "@/components/layout/page-hero";

export const metadata: Metadata = { title: "Privacy & Safety" };

const SECTIONS = [
  { title: "Location is consent-based", body: "Nothing is shared by default. You pick each person and choose always-on, temporary, paused or stopped sharing. Stopping a share removes your last position from it. The web app only reads location while open and after you grant browser permission." },
  { title: "Microphone is never used covertly", body: "The web app uses the microphone only for a visible, user-started test. The future Android app will run voice detection on-device with a persistent notification, and raw audio is never uploaded." },
  { title: "Who can see an emergency", body: "Only you and the contacts who were actually alerted for that emergency. Administrators see redacted activity (no location, notes or contact details), and every access to sensitive data is audit-logged." },
  { title: "Community helpers", body: "Helpers are opted-in community members whose identity has been checked. They are not police officers or professional responders. They receive only an approximate distance, never your exact location." },
  { title: "Honest status, no false promises", body: "We show Sent, Delivered or Acknowledged only once the relevant system confirms it. SafeHer depends on networks and devices, so alert delivery can never be guaranteed. Always call 112 in immediate danger." },
  { title: "Your data, your control", body: "Invitations are single-use and expire. You can block or remove contacts, leave someone's circle, and permanently delete your account and all of your data from Account Settings." },
  { title: "Security", body: "HTTPS everywhere, Firebase Authentication, server-side authorization on every API call, input validation, rate limiting, Firestore Security Rules that deny by default, and no secrets in client code." },
];

export default function PrivacyPage() {
  return (
    <>
      <PageHero eyebrow="Privacy & Safety" title="Protection without surveillance">
        The commitments SafeHer is engineered around.
      </PageHero>
      <section className="container grid max-w-5xl gap-5 py-16 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <article key={s.title} className="rounded-2xl border bg-card p-6 shadow-soft">
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
          </article>
        ))}
      </section>
    </>
  );
}
