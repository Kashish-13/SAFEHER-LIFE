"use client";

import { useState } from "react";
import { contactCreateSchema } from "@/core/validation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import { InviteLink } from "./invite-link";

const RELATIONSHIPS = ["Mother", "Father", "Sister", "Brother", "Partner", "Spouse", "Best friend", "Friend", "Roommate", "Colleague", "Relative", "Other"];

export function ContactFormDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(true);
  const [result, setResult] = useState<{ link: string; name: string } | null>(null);

  const close = () => { setResult(null); setErrors({}); setServerError(null); onClose(); };

  return (
    <Dialog open={open} onClose={close} title={result ? "Share the invitation" : "Add a trusted contact"} description={result ? undefined : "They'll need to accept before they can receive your alerts."}>
      {result ? (
        <div className="space-y-4"><InviteLink link={result.link} name={result.name} /><Button className="w-full" onClick={close}>Done</Button></div>
      ) : (
        <form
          className="space-y-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const raw = {
              name: String(f.get("name") ?? ""), relationship: String(f.get("relationship") ?? ""),
              email: String(f.get("email") ?? "").trim() || null, phone: String(f.get("phone") ?? "").trim() || null,
              priority: String(f.get("priority")), notifyOnEmergency: notify,
            };
            const parsed = contactCreateSchema.safeParse(raw); // same schema the server enforces
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
              return;
            }
            setErrors({}); setBusy(true); setServerError(null);
            try {
              const r = await api<{ inviteLink: string; contact: { name: string } }>("/api/contacts", { body: parsed.data });
              setResult({ link: r.inviteLink, name: r.contact.name });
              onCreated();
            } catch (err) { setServerError((err as Error).message); } finally { setBusy(false); }
          }}
        >
          <Field id="name" label="Name" error={errors.name}><Input id="name" name="name" maxLength={80} aria-invalid={!!errors.name} /></Field>
          <Field id="relationship" label="Relationship" error={errors.relationship}>
            <Select id="relationship" name="relationship" defaultValue="">
              <option value="" disabled>Select…</option>
              {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="email" label="Email" error={errors.email}><Input id="email" name="email" type="email" aria-invalid={!!errors.email} /></Field>
            <Field id="phone" label="Phone" error={errors.phone} hint="With country code"><Input id="phone" name="phone" type="tel" placeholder="+91…" aria-invalid={!!errors.phone} /></Field>
          </div>
          <Field id="priority" label="Priority" hint="Primary contacts are alerted first. Secondary contacts are alerted if no primary acknowledges in time.">
            <Select id="priority" name="priority" defaultValue="primary">
              <option value="primary">Primary: alert immediately</option>
              <option value="secondary">Secondary: alert on escalation</option>
            </Select>
          </Field>
          <div className="flex items-center justify-between rounded-xl border p-3">
            <label htmlFor="notify" className="text-sm font-medium">Receive emergency alerts</label>
            <Switch id="notify" checked={notify} onCheckedChange={setNotify} />
          </div>
          {serverError && <Alert tone="emergency">{serverError}</Alert>}
          <Button type="submit" className="w-full" loading={busy}>Create invitation</Button>
        </form>
      )}
    </Dialog>
  );
}
