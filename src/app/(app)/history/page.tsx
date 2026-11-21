"use client";

import { ChevronRight, FlaskConical, History, MapPin } from "lucide-react";
import Link from "next/link";
import type { EmergencyEvent } from "@/core/types";
import { TRIGGER_LABEL } from "@/components/emergency/labels";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, EmptyState, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { useApi } from "@/hooks/use-api";
import { formatDateTime } from "@/lib/utils";

export default function HistoryPage() {
  const { data, loading, error, reload } = useApi<{ events: EmergencyEvent[] }>("/api/emergencies");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Emergency history" description="A private record of your emergencies. Only you can see this list." />
      {loading ? <LoadingBlock /> : error ? <ErrorState message={error} onRetry={reload} /> : data!.events.length === 0 ? (
        <EmptyState icon={History} title="No emergencies yet" description="Emergencies you trigger will appear here with who responded and when." />
      ) : (
        <Card>
          <CardContent className="divide-y p-2">
            {data!.events.map((e) => (
              <Link key={e.id} href={`/emergency/${e.id}`} className="flex items-center gap-3 rounded-xl px-3 py-3.5 hover:bg-secondary/60">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{TRIGGER_LABEL[e.trigger]}{e.isSimulated && <Badge tone="warning"><FlaskConical />Simulated</Badge>}{e.escalationLevel > 0 && <Badge>Escalated</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}{e.location && <> · <MapPin className="inline size-3" /> location shared</>}</p>
                </div>
                <Badge tone={e.status === "active" ? "emergency" : e.status === "resolved" ? "success" : "neutral"} className="capitalize">{e.status}</Badge>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
