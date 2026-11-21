"use client";

import { cn } from "@/lib/utils";

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-xl bg-secondary p-1", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn("flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition", value === t.value && "bg-card text-foreground shadow-sm")}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11px]">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
