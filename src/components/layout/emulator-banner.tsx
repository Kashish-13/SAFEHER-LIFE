import { FlaskConical } from "lucide-react";
import { clientMode } from "@/lib/config";

/**
 * Permanent, non-dismissible notice shown on EVERY page while the app runs
 * against the local Firebase Emulator Suite. Renders nothing in any other mode.
 */
export function EmulatorBanner() {
  if (clientMode.mode !== "emulator") return null;
  return (
    <div
      role="status"
      data-testid="emulator-banner"
      className="flex items-center justify-center gap-2 bg-[hsl(265_60%_92%)] px-4 py-1.5 text-center text-xs font-semibold text-[hsl(265_55%_28%)]"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
      Local emulator, test data only
    </div>
  );
}
