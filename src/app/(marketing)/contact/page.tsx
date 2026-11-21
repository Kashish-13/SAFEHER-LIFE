import { Mail, Phone, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { PageHero } from "@/components/layout/page-hero";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact" title="Get in touch" />
      <section className="container grid max-w-5xl gap-8 py-16 md:grid-cols-[1fr_1.4fr]">
        <div className="space-y-4">
          <a href="tel:112" className="flex gap-3 rounded-2xl border border-emergency/20 bg-emergency-soft p-5">
            <ShieldAlert className="size-5 shrink-0 text-emergency" />
            <div><p className="font-semibold text-emergency">In danger right now?</p><p className="text-sm text-emergency/80">Don&apos;t use this form. Call 112 immediately.</p></div>
          </a>
          <div className="flex gap-3 rounded-2xl border bg-card p-5 shadow-soft">
            <Phone className="size-5 shrink-0 text-accent" />
            <div><p className="font-semibold">Women Helpline</p><p className="text-sm text-muted-foreground">181 (24×7, India)</p></div>
          </div>
          <div className="flex gap-3 rounded-2xl border bg-card p-5 shadow-soft">
            <Mail className="size-5 shrink-0 text-accent" />
            <div><p className="font-semibold">Product & partnerships</p><p className="text-sm text-muted-foreground">Use the form and we&apos;ll reply by email.</p></div>
          </div>
        </div>
        <ContactForm />
      </section>
    </>
  );
}
