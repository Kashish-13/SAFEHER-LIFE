"use client";

import { Bell, Car, CheckCheck, MapPin, Siren, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import type { AppNotification } from "@/core/types";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, EmptyState, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { useApi } from "@/hooks/use-api";
import { useSafetyStatus } from "@/hooks/use-safety-status";
import { api } from "@/lib/api-client";
import { cn, timeAgo } from "@/lib/utils";

const ICONS: Record<AppNotification["type"], typeof Bell> = {
  emergency_alert: Siren, emergency_update: Siren, contact_invitation: UserPlus, invitation_response: UserPlus,
  journey_checkin_due: Car, journey_update: Car, location_share: MapPin, system: Bell,
};

export default function NotificationsPage() {
  const router = useRouter();
  const { refresh } = useSafetyStatus();
  const { data, loading, error, reload } = useApi<{ notifications: AppNotification[]; unread: number }>("/api/notifications", { pollMs: 10_000 });

  const open = async (n: AppNotification) => {
    if (!n.read) api(`/api/notifications/${n.id}`, { method: "PATCH" }).then(() => { reload(); refresh(); }).catch(() => {});
    if (n.link) router.push(n.link);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notifications" actions={(data?.unread ?? 0) > 0 && (
        <Button variant="outline" size="sm" onClick={async () => { await api("/api/notifications", { method: "PATCH" }); reload(); refresh(); }}><CheckCheck />Mark all read</Button>
      )} />
      {loading ? <LoadingBlock /> : error ? <ErrorState message={error} onRetry={reload} /> : data!.notifications.length === 0 ? (
        <EmptyState icon={Bell} title="You're all caught up" description="Alerts, invitations and journey updates will appear here." />
      ) : (
        <Card>
          <CardContent className="divide-y p-2">
            {data!.notifications.map((n) => {
              const Icon = ICONS[n.type];
              const urgent = n.type === "emergency_alert";
              return (
                <button key={n.id} onClick={() => open(n)} className={cn("flex w-full gap-3 rounded-xl px-3 py-3.5 text-left hover:bg-secondary/60", !n.read && "bg-secondary/40")}>
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", urgent ? "bg-emergency text-white" : "bg-secondary text-primary")}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={cn("text-sm", !n.read ? "font-semibold" : "font-medium")}>{n.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </span>
                    <span className="block text-sm text-muted-foreground">{n.body}</span>
                    {n.isSimulated && <Badge tone="warning" className="mt-1">Simulated</Badge>}
                  </span>
                  {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
