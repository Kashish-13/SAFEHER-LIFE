import { AlertCircle, Check, CheckCheck, Clock, Send, XCircle } from "lucide-react";
import { STATUS_LABELS } from "@/core/notification-status";
import type { EmergencyResponse, ResponseStatus } from "@/core/types";
import { Badge } from "@/components/ui/feedback";
import { cn, formatTime, initials } from "@/lib/utils";

const META: Record<ResponseStatus, { tone: "neutral" | "accent" | "success" | "warning" | "emergency" | "primary"; icon: typeof Check }> = {
  queued: { tone: "neutral", icon: Clock },
  sent: { tone: "primary", icon: Send },
  delivered: { tone: "accent", icon: Check },
  acknowledged: { tone: "success", icon: CheckCheck },
  declined: { tone: "warning", icon: XCircle },
  failed: { tone: "emergency", icon: AlertCircle },
};

export function ResponseStatusBadge({ status }: { status: ResponseStatus }) {
  const { tone, icon: Icon } = META[status];
  return <Badge tone={tone}><Icon aria-hidden />{STATUS_LABELS[status]}</Badge>;
}

export function ResponseList({ responses, showHistory }: { responses: EmergencyResponse[]; showHistory?: boolean }) {
  return (
    <ul className="divide-y">
      {responses.map((r) => (
        <li key={r.id} className="py-3.5 first:pt-0 last:pb-0">
          <div className="flex items-center gap-3">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-full text-xs font-bold", r.status === "acknowledged" ? "bg-success text-white" : "bg-secondary text-primary")}>{initials(r.contactName)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{r.contactName}</p>
              <p className="text-xs capitalize text-muted-foreground">{r.tier} contact{r.history.length ? ` · updated ${formatTime(r.updatedAt)}` : ""}</p>
            </div>
            <ResponseStatusBadge status={r.status} />
          </div>
          {r.status === "failed" && r.failureReason && <p className="ml-[52px] mt-1.5 text-xs text-emergency">{r.failureReason}</p>}
          {showHistory && r.history.length > 1 && (
            <p className="ml-[52px] mt-1 text-[11px] text-muted-foreground">
              {r.history.map((h) => `${STATUS_LABELS[h.status]} ${formatTime(h.at)}${h.detail ? ` (${h.detail})` : ""}`).join(" → ")}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
