"use client";

import { Activity, FileClock, ShieldAlert, Users } from "lucide-react";
import { useState } from "react";
import type { AuditLog, Role } from "@/core/types";
import { ROLES } from "@/core/types";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";

interface Stats { users: number; helpers: number; activeEmergencies: number; emergencies24h: number; simulatedEmergencies: number; acceptedContacts: number }
interface AdminUser { id: string; fullName: string; email: string; roles: Role[]; disabled: boolean; phoneVerified: boolean; createdAt: string }
interface AdminEvent { id: string; userId: string; trigger: string; status: string; escalationLevel: number; isSimulated: boolean; hasLocation: boolean; createdAt: string }

type Tab = "users" | "emergencies" | "audit";

function UsersTable() {
  const { uid } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ users: AdminUser[] }>("/api/admin/users");
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const update = async (u: AdminUser, body: { roles: Role[]; disabled?: boolean }) => {
    try { await api(`/api/admin/users/${u.id}`, { method: "PATCH", body }); toast("User updated"); reload(); } catch (e) { toast((e as Error).message, "error"); }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="py-2">User</th><th>Roles</th><th>Joined</th><th className="text-right">Enabled</th></tr></thead>
        <tbody className="divide-y">
          {data!.users.map((u) => (
            <tr key={u.id}>
              <td className="py-3"><p className="font-medium">{u.fullName}</p><p className="text-xs text-muted-foreground">{u.email}</p></td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {ROLES.map((r) => {
                    const on = u.roles.includes(r);
                    return (
                      <button key={r} disabled={u.id === uid && r === "admin"} onClick={() => update(u, { roles: on ? u.roles.filter((x) => x !== r) : [...u.roles, r] })}
                        className={`rounded-full border px-2 py-0.5 text-[11px] capitalize disabled:opacity-50 ${on ? "border-primary bg-primary text-white" : "text-muted-foreground"}`}>
                        {r.replace("_", " ")}
                      </button>
                    );
                  })}
                </div>
              </td>
              <td className="text-xs text-muted-foreground">{formatDateTime(u.createdAt)}</td>
              <td className="text-right"><Switch label={`Enable ${u.fullName}`} checked={!u.disabled} disabled={u.id === uid} onCheckedChange={(v) => update(u, { roles: u.roles, disabled: !v })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmergencyActivity() {
  const { data, loading, error, reload } = useApi<{ events: AdminEvent[] }>("/api/admin/emergencies", { pollMs: 15000 });
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      <Alert tone="neutral">Redacted view: locations, notes and contact details are never shown to administrators.</Alert>
      <ul className="divide-y">
        {data!.events.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div><p className="font-mono text-xs">{e.id}</p><p className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)} · {e.trigger} · user {e.userId.slice(0, 10)}…</p></div>
            <div className="flex gap-1">
              {e.isSimulated && <Badge tone="warning">Simulated</Badge>}
              {e.escalationLevel > 0 && <Badge>Escalated</Badge>}
              <Badge tone={e.status === "active" ? "emergency" : "neutral"} className="capitalize">{e.status}</Badge>
            </div>
          </li>
        ))}
        {data!.events.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No emergency activity.</p>}
      </ul>
    </div>
  );
}

function AuditTrail() {
  const { data, loading, error, reload } = useApi<{ logs: AuditLog[] }>("/api/admin/audit-logs");
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <ul className="divide-y font-mono text-xs">
      {data!.logs.map((l) => (
        <li key={l.id} className="flex flex-wrap gap-x-3 py-2">
          <span className="text-muted-foreground">{formatDateTime(l.createdAt)}</span>
          <span className="font-semibold">{l.action}</span>
          <span className="text-muted-foreground">{l.targetType}:{l.targetId?.slice(0, 14)}</span>
          <span className="text-muted-foreground">by {l.actorId ?? "system"}</span>
        </li>
      ))}
      {data!.logs.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No audit entries yet.</p>}
    </ul>
  );
}

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("users");
  const stats = useApi<{ stats: Stats }>(profile?.roles.includes("admin") ? "/api/admin/stats" : null);

  if (!profile?.roles.includes("admin")) return <Alert tone="emergency" title="Administrators only">You don&apos;t have access to this page.</Alert>;
  const s = stats.data?.stats;

  return (
    <div className="space-y-6">
      <PageHeader title="Admin console" description="Platform management. Access is enforced server-side and every change is audit-logged." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: Users, label: "Users", value: s?.users },
          { icon: ShieldAlert, label: "Active emergencies", value: s?.activeEmergencies },
          { icon: Activity, label: "Emergencies (24h)", value: s?.emergencies24h },
          { icon: FileClock, label: "Accepted contact links", value: s?.acceptedContacts },
        ].map((x) => (
          <Card key={x.label}><CardContent className="p-5"><x.icon className="size-4 text-accent" /><p className="mt-2 text-2xl font-bold">{x.value ?? "–"}</p><p className="text-xs text-muted-foreground">{x.label}</p></CardContent></Card>
        ))}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "users", label: "Users & roles" }, { value: "emergencies", label: "Emergency activity" }, { value: "audit", label: "Audit log" }]} />
      <Card>
        <CardHeader><CardTitle>{tab === "users" ? "Users & roles" : tab === "emergencies" ? "Emergency activity" : "Audit log"}</CardTitle></CardHeader>
        <CardContent>{tab === "users" ? <UsersTable /> : tab === "emergencies" ? <EmergencyActivity /> : <AuditTrail />}</CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Helper verification, community report moderation and abuse reports are scheduled for the next phase (see docs/ROADMAP.md).</p>
    </div>
  );
}
