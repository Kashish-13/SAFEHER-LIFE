import type { Metadata } from "next";
import { PageHero } from "@/components/layout/page-hero";
import { Badge } from "@/components/ui/feedback";
import { AVAILABILITY_LABEL, FEATURES } from "@/content/features";

export const metadata: Metadata = { title: "Features" };

export default function FeaturesPage() {
  return (
    <>
      <PageHero eyebrow="Features" title="A complete personal safety toolkit">
        Built around one idea: a single trigger should start a coordinated response.
      </PageHero>
      <section className="container py-16">
        <div className="mb-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
          <Badge tone="success">Available</Badge> works in the web app today
          <Badge>Coming next</Badge> backend designed, UI in the next phase
          <Badge tone="primary">Native app</Badge> needs the Android/iOS app
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article key={f.title} className="rounded-2xl border bg-card p-6 shadow-soft">
              <div className="flex items-start justify-between">
                <div className="grid size-11 place-items-center rounded-xl bg-primary text-white"><f.icon className="size-5" /></div>
                <Badge tone={f.availability === "web" ? "success" : f.availability === "mobile" ? "primary" : "neutral"}>{AVAILABILITY_LABEL[f.availability]}</Badge>
              </div>
              <h2 className="mt-4 text-lg font-semibold">{f.title}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
