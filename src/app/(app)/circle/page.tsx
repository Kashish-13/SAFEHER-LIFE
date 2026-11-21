"use client";

import { Ban, Bell, BellOff, MoreVertical, Pencil, Plus, RotateCw, ShieldAlert, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import type { EmergencyCircle, TrustedContact } from "@/core/types";
import { CircleFormDialog } from "@/components/circle/circle-form-dialog";
import { ContactFormDialog } from "@/components/circle/contact-form-dialog";
import { InviteLink } from "@/components/circle/invite-link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge, EmptyState, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api-client";
import { cn, formatDateTime, initials } from "@/lib/utils";

type Tab = "contacts" | "circles" | "incoming";
interface Incoming { linkId: string; ownerName: string; relationship: string; priority: string; status: "accepted" | "awaiting_approval"; since: string }

const STATUS_TONE = { pending: "warning", awaiting_approval: "primary", accepted: "success", rejected: "neutral", claim_rejected: "neutral", blocked: "emergency", removed: "neutral" } as const;
const STATUS_TEXT = { pending: "Invitation pending", awaiting_approval: "Needs your approval", accepted: "Accepted", rejected: "Declined", claim_rejected: "Not approved", blocked: "Blocked", removed: "Removed" } as const;

/** Owner reviews WHO actually used the invitation link before granting any access. */
function ClaimApprovalCard({ c, onChanged }: { c: TrustedContact; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const claim = c.claim!;
  const mismatch = claim.matchesInvite.email === false || claim.matchesInvite.phone === false;
  const matched = claim.matchesInvite.email === true || claim.matchesInvite.phone === true;
  const decide = async (action: "approve_claim" | "reject_claim") => {
    setBusy(action);
    try {
      await api(`/api/contacts/${c.id}`, { method: "PATCH", body: { action } });
      toast(action === "approve_claim" ? `${claim.displayName} can now receive your alerts` : "Request rejected. No access was granted.");
      onChanged();
    } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(null); }
  };
  const Check = ({ ok, label }: { ok: boolean | null; label: string }) =>
    ok === null ? null : <Badge tone={ok ? "success" : "emergency"}>{ok ? <ShieldCheck /> : <ShieldAlert />}{label} {ok ? "matches" : "doesn't match"}</Badge>;

  return (
    <Card className={cn("border-2", mismatch ? "border-emergency/40" : "border-primary/30")}>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-sm font-bold text-primary">{initials(claim.displayName)}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Approve {claim.displayName} as your {c.relationship.toLowerCase()}?</p>
            <p className="text-xs text-muted-foreground">Accepted the invitation you sent to <strong>{c.name}</strong> · {formatDateTime(claim.claimedAt)}</p>
          </div>
        </div>
        <dl className="grid gap-2 rounded-xl bg-secondary/50 p-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Account name</dt><dd className="font-medium">{claim.displayName}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Account email</dt><dd className="break-all font-medium">{claim.email ?? "—"} {claim.emailVerified && <Badge tone="success" className="ml-1">verified</Badge>}</dd></div>
          {claim.phone && <div><dt className="text-xs text-muted-foreground">Account phone</dt><dd className="font-medium">{claim.phone} {claim.phoneVerified && <Badge tone="success" className="ml-1">verified</Badge>}</dd></div>}
          <div><dt className="text-xs text-muted-foreground">You invited</dt><dd className="break-all font-medium">{c.email ?? c.phone}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2"><Check ok={claim.matchesInvite.email} label="Email" /><Check ok={claim.matchesInvite.phone} label="Phone" /></div>
        {mismatch ? (
          <Alert tone="emergency" title="This account doesn't match who you invited">The link may have been forwarded. Only approve if you're certain this is the right person. Approving lets them receive your alerts and location.</Alert>
        ) : matched ? (
          <Alert tone="success">The verified account details match the invitation.</Alert>
        ) : (
          <Alert tone="warning">We couldn&apos;t compare details. Make sure you recognise this account before approving.</Alert>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" loading={busy === "reject_claim"} onClick={() => decide("reject_claim")}>Reject</Button>
          <Button variant={mismatch ? "emergency" : "accent"} loading={busy === "approve_claim"} onClick={() => (!mismatch || confirm(`Approve ${claim.displayName} even though their details don't match ${c.name}?`)) && decide("approve_claim")}>
            {mismatch ? "Approve anyway" : "Approve"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ContactRow({ c, onChanged, onInvite }: { c: TrustedContact; onChanged: () => void; onInvite: (link: string, name: string) => void }) {
  const [menu, setMenu] = useState(false);
  const toast = useToast();
  const update = async (body: Record<string, unknown>, msg: string) => {
    setMenu(false);
    try {
      const r = await api<{ inviteLink: string | null }>(`/api/contacts/${c.id}`, { method: "PATCH", body });
      toast(msg); onChanged();
      if (r.inviteLink) onInvite(r.inviteLink, c.name);
    } catch (e) { toast((e as Error).message, "error"); }
  };

  return (
    <li className="flex items-center gap-3 py-3.5">
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold", c.status === "accepted" ? "bg-primary text-white" : "bg-secondary text-muted-foreground")}>{initials(c.name)}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 font-semibold">
          {c.name}
          <Badge tone={c.priority === "primary" ? "primary" : "neutral"} className="capitalize">{c.priority}</Badge>
          {!c.notifyOnEmergency && <Badge><BellOff />Alerts off</Badge>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{c.relationship} · {c.email ?? c.phone}</p>
        {c.status === "accepted" && c.claim && (
          <p className="truncate text-xs text-muted-foreground">Linked account: <span className="font-medium text-foreground">{c.claim.displayName}</span>{c.claim.email ? ` · ${c.claim.email}` : ""}</p>
        )}
      </div>
      <Badge tone={STATUS_TONE[c.status]} className="hidden sm:inline-flex">{STATUS_TEXT[c.status]}</Badge>
      <div className="relative">
        <Button variant="ghost" size="icon" onClick={() => setMenu(!menu)} aria-label={`Actions for ${c.name}`} aria-expanded={menu}><MoreVertical /></Button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} aria-hidden />
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border bg-card p-1.5 shadow-lg" role="menu">
              <p className="px-3 py-1.5 text-xs text-muted-foreground sm:hidden">{STATUS_TEXT[c.status]}</p>
              <MenuItem icon={Users} onClick={() => update({ priority: c.priority === "primary" ? "secondary" : "primary" }, "Priority updated")}>Make {c.priority === "primary" ? "secondary" : "primary"}</MenuItem>
              <MenuItem icon={c.notifyOnEmergency ? BellOff : Bell} onClick={() => update({ notifyOnEmergency: !c.notifyOnEmergency }, "Alert preference updated")}>{c.notifyOnEmergency ? "Turn off alerts" : "Turn on alerts"}</MenuItem>
              {(c.status === "pending" || c.status === "rejected" || c.status === "claim_rejected") && <MenuItem icon={RotateCw} onClick={() => update({ action: "resend_invite" }, "New invitation link created")}>Resend invitation</MenuItem>}
              {c.status === "blocked"
                ? <MenuItem icon={Ban} onClick={() => update({ action: "unblock" }, "Contact unblocked")}>Unblock</MenuItem>
                : <MenuItem icon={Ban} onClick={() => update({ action: "block" }, "Contact blocked. Location sharing stopped.")}>Block</MenuItem>}
              <MenuItem icon={Trash2} danger onClick={() => confirm(`Remove ${c.name} from your trusted contacts?`) && update({ action: "remove" }, "Contact removed")}>Remove</MenuItem>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function MenuItem({ icon: Icon, children, onClick, danger }: { icon: typeof Users; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary", danger && "text-emergency")}>
      <Icon className="size-4" />{children}
    </button>
  );
}

export default function CirclePage() {
  const [tab, setTab] = useState<Tab>("contacts");
  const [addOpen, setAddOpen] = useState(false);
  const [circleDialog, setCircleDialog] = useState<{ open: boolean; circle: EmergencyCircle | null }>({ open: false, circle: null });
  const [invite, setInvite] = useState<{ link: string; name: string } | null>(null);
  const toast = useToast();
  const contacts = useApi<{ contacts: TrustedContact[] }>("/api/contacts");
  const circles = useApi<{ circles: EmergencyCircle[] }>("/api/circles");
  const incoming = useApi<{ incoming: Incoming[] }>("/api/contacts/incoming");

  const list = contacts.data?.contacts ?? [];
  const awaiting = list.filter((c) => c.status === "awaiting_approval" && c.claim);
  const rest = list.filter((c) => !(c.status === "awaiting_approval" && c.claim));
  const primary = rest.filter((c) => c.priority === "primary");
  const secondary = rest.filter((c) => c.priority === "secondary");
  const byId = new Map(list.map((c) => [c.id, c]));

  return (
    <div>
      <PageHeader
        title="Trusted emergency circle"
        description="The people SafeHer alerts when you trigger SOS."
        actions={tab === "circles"
          ? <Button onClick={() => setCircleDialog({ open: true, circle: null })}><Plus /> New circle</Button>
          : <Button onClick={() => setAddOpen(true)}><UserPlus /> Add contact</Button>}
      />
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[
        { value: "contacts", label: "Contacts", count: list.length },
        { value: "circles", label: "Circles", count: circles.data?.circles.length },
        { value: "incoming", label: "I'm a contact for", count: incoming.data?.incoming.length },
      ]} />

      {tab === "contacts" && (
        contacts.loading ? <LoadingBlock /> : contacts.error ? <ErrorState message={contacts.error} onRetry={contacts.reload} /> : list.length === 0 ? (
          <EmptyState icon={Users} title="No trusted contacts yet" description="Add family or friends who should be alerted in an emergency. They'll receive an invitation to accept." action={<Button onClick={() => setAddOpen(true)}><UserPlus /> Add your first contact</Button>} />
        ) : (
          <div className="space-y-5">
            {awaiting.length > 0 && (
              <section className="space-y-3" aria-label="Requests waiting for your approval">
                <h2 className="font-semibold">Waiting for your approval</h2>
                <p className="text-sm text-muted-foreground">Nobody gets access to your alerts or location until you approve the account that used your invitation.</p>
                {awaiting.map((c) => <ClaimApprovalCard key={c.id} c={c} onChanged={contacts.reload} />)}
              </section>
            )}
            {[{ title: "Primary contacts", hint: "Alerted immediately and simultaneously", items: primary }, { title: "Secondary contacts", hint: "Alerted if no primary contact acknowledges in time", items: secondary }].map((g) => (
              <Card key={g.title}>
                <CardContent className="pt-5">
                  <div className="mb-1 flex items-baseline justify-between"><h2 className="font-semibold">{g.title}</h2><p className="text-xs text-muted-foreground">{g.hint}</p></div>
                  {g.items.length === 0 ? <p className="py-4 text-sm text-muted-foreground">None yet.</p> : (
                    <ul className="divide-y">{g.items.map((c) => <ContactRow key={c.id} c={c} onChanged={contacts.reload} onInvite={(link, name) => setInvite({ link, name })} />)}</ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === "circles" && (
        circles.loading ? <LoadingBlock /> : (circles.data?.circles.length ?? 0) === 0 ? (
          <EmptyState icon={Users} title="No circles yet" description="Group contacts (e.g. Family, Friends) to control who each SOS reaches." action={<Button onClick={() => setCircleDialog({ open: true, circle: null })}><Plus /> Create a circle</Button>} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {circles.data!.circles.map((ci) => (
              <Card key={ci.id}>
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between">
                    <div><h2 className="font-semibold">{ci.name}</h2>{ci.description && <p className="text-sm text-muted-foreground">{ci.description}</p>}</div>
                    <div className="flex">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${ci.name}`} onClick={() => setCircleDialog({ open: true, circle: ci })}><Pencil /></Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${ci.name}`} onClick={async () => {
                        if (!confirm(`Delete the ${ci.name} circle? Contacts are kept.`)) return;
                        try { await api(`/api/circles/${ci.id}`, { method: "DELETE" }); toast("Circle deleted"); circles.reload(); } catch (e) { toast((e as Error).message, "error"); }
                      }}><Trash2 /></Button>
                    </div>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {ci.contactIds.map((id) => byId.get(id)).filter(Boolean).map((c) => (
                      <li key={c!.id} className="flex items-center gap-1.5 rounded-full bg-secondary py-1 pl-1 pr-3 text-xs font-medium">
                        <span className="grid size-6 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">{initials(c!.name)}</span>{c!.name}
                      </li>
                    ))}
                    {ci.contactIds.length === 0 && <li className="text-sm text-muted-foreground">No members</li>}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === "incoming" && (
        incoming.loading ? <LoadingBlock /> : (incoming.data?.incoming.length ?? 0) === 0 ? (
          <EmptyState icon={Users} title="You're not in anyone's circle yet" description="When someone invites you and you accept, you'll appear in their circle and receive their alerts." />
        ) : (
          <Card><CardContent className="pt-5">
            <ul className="divide-y">
              {incoming.data!.incoming.map((i) => (
                <li key={i.linkId} className="flex items-center gap-3 py-3.5">
                  <span className="grid size-11 place-items-center rounded-full bg-primary text-sm font-bold text-white">{initials(i.ownerName)}</span>
                  <div className="flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">{i.ownerName}{i.status === "awaiting_approval" && <Badge tone="primary">Waiting for their approval</Badge>}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.status === "awaiting_approval"
                        ? `You accepted their invitation. You'll receive alerts once ${i.ownerName.split(" ")[0]} confirms it's you.`
                        : `You're their ${i.relationship.toLowerCase()} · ${i.priority} contact since ${formatDateTime(i.since)}`}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-emergency" onClick={async () => {
                    const msg = i.status === "awaiting_approval" ? `Withdraw your request to join ${i.ownerName}'s circle?` : `Leave ${i.ownerName}'s emergency circle? You'll stop receiving their alerts and lose access to their past emergencies.`;
                    if (!confirm(msg)) return;
                    try { await api(`/api/contacts/incoming/${i.linkId}`, { method: "DELETE" }); toast(i.status === "awaiting_approval" ? "Request withdrawn" : "You left the circle"); incoming.reload(); } catch (e) { toast((e as Error).message, "error"); }
                  }}>{i.status === "awaiting_approval" ? "Withdraw" : "Leave"}</Button>
                </li>
              ))}
            </ul>
          </CardContent></Card>
        )
      )}

      <ContactFormDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={contacts.reload} />
      <CircleFormDialog open={circleDialog.open} circle={circleDialog.circle} contacts={list} onClose={() => setCircleDialog({ open: false, circle: null })} onSaved={() => { circles.reload(); toast("Circle saved"); }} />
      <Dialog open={!!invite} onClose={() => setInvite(null)} title="New invitation link">
        {invite && <div className="space-y-4"><InviteLink link={invite.link} name={invite.name} /><Button className="w-full" onClick={() => setInvite(null)}>Done</Button></div>}
      </Dialog>
    </div>
  );
}
