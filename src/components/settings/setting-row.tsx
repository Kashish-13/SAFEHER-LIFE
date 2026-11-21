import type { ReactNode } from "react";

export function SettingRow({ id, title, description, control }: { id: string; title: string; description?: ReactNode; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <label htmlFor={id} className="min-w-0">
        <span className="block font-medium">{title}</span>
        {description && <span className="block text-sm text-muted-foreground">{description}</span>}
      </label>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
