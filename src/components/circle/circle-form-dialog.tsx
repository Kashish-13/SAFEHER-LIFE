"use client";

import { useEffect, useState } from "react";
import type { EmergencyCircle, TrustedContact } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { api } from "@/lib/api-client";

export function CircleFormDialog({ open, onClose, onSaved, contacts, circle }: {
  open: boolean; onClose: () => void; onSaved: () => void; contacts: TrustedContact[]; circle: EmergencyCircle | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(circle?.name ?? ""); setDescription(circle?.description ?? ""); setSelected(circle?.contactIds ?? []); setError(null);
  }, [open, circle]);

  const eligible = contacts.filter((c) => c.status !== "removed");

  return (
    <Dialog open={open} onClose={onClose} title={circle ? `Edit ${circle.name}` : "New circle"} description="Group contacts so you can choose who an SOS reaches.">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setError(null);
          try {
            const body = { name, description, contactIds: selected };
            if (circle) await api(`/api/circles/${circle.id}`, { method: "PUT", body });
            else await api("/api/circles", { body });
            onSaved(); onClose();
          } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
        }}
      >
        <Field id="cname" label="Circle name"><Input id="cname" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} placeholder="e.g. Family" /></Field>
        <Field id="cdesc" label="Description (optional)"><Input id="cdesc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Members</legend>
          {eligible.length === 0 ? <p className="text-sm text-muted-foreground">Add trusted contacts first.</p> : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {eligible.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 hover:bg-secondary/50">
                  <input type="checkbox" className="size-4 accent-[hsl(var(--accent))]" checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id))} />
                  <span className="flex-1 text-sm"><strong>{c.name}</strong> <span className="text-muted-foreground">· {c.relationship}</span></span>
                  {c.status !== "accepted" && <span className="text-xs capitalize text-warning">{c.status}</span>}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {error && <Alert tone="emergency">{error}</Alert>}
        <Button type="submit" className="w-full" loading={busy}>{circle ? "Save changes" : "Create circle"}</Button>
      </form>
    </Dialog>
  );
}
