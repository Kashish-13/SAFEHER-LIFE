import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle, type LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "warning" | "emergency" | "primary";

const badgeTone: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-accent/10 text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  emergency: "bg-emergency-soft text-emergency",
  primary: "bg-primary/10 text-primary",
};

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold [&_svg]:size-3", badgeTone[tone], className)} {...props} />;
}

const alertStyles: Record<Exclude<Tone, "primary" | "accent">, { box: string; icon: LucideIcon }> = {
  neutral: { box: "border-border bg-muted/60 text-foreground", icon: Info },
  success: { box: "border-success/20 bg-success-soft text-success", icon: CheckCircle2 },
  warning: { box: "border-warning/25 bg-warning-soft text-[hsl(30_80%_28%)]", icon: AlertTriangle },
  emergency: { box: "border-emergency/25 bg-emergency-soft text-emergency", icon: XCircle },
};

export function Alert({ tone = "neutral", title, children, className, action }: { tone?: keyof typeof alertStyles; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const { box, icon: Icon } = alertStyles[tone];
  return (
    <div role={tone === "emergency" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border p-3.5 text-sm", box, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-muted-foreground", className)} aria-label={label} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-muted", className)} aria-hidden />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-16" />)}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-2xl border border-dashed bg-card/50 px-6 py-10 text-center", className)}>
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><Icon className="size-6" aria-hidden /></div>
      <p className="font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert tone="emergency" title="Couldn't load this" action={onRetry && <button onClick={onRetry} className="text-sm font-semibold underline">Retry</button>}>
      {message}
    </Alert>
  );
}
