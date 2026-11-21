"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/form";

/**
 * Contact form. No email provider is configured yet, so instead of pretending
 * to send, it opens the user's mail client with the message pre-filled.
 */
export function ContactForm() {
  const [done, setDone] = useState(false);
  return (
    <form
      className="space-y-4 rounded-2xl border bg-card p-6 shadow-soft"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const subject = encodeURIComponent(`SafeHer enquiry from ${f.get("name")}`);
        const body = encodeURIComponent(`${f.get("message")}\n\n— ${f.get("name")} (${f.get("email")})`);
        window.location.href = `mailto:hello@safeher.app?subject=${subject}&body=${body}`;
        setDone(true);
      }}
    >
      <Field id="name" label="Name"><Input id="name" name="name" required maxLength={80} autoComplete="name" /></Field>
      <Field id="email" label="Email"><Input id="email" name="email" type="email" required autoComplete="email" /></Field>
      <Field id="message" label="Message"><Textarea id="message" name="message" required maxLength={2000} rows={5} /></Field>
      {done && <Alert tone="success">Your email app should have opened with your message. Send it from there.</Alert>}
      <Button type="submit" className="w-full">Compose email</Button>
    </form>
  );
}
