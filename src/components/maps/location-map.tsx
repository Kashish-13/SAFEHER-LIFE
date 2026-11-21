import { ExternalLink, MapPin } from "lucide-react";
import type { GeoPoint } from "@/core/types";
import { googleMapsKey } from "@/lib/config";
import { cn, mapsLink, timeAgo } from "@/lib/utils";

/**
 * Shows an authorised location. Uses the Google Maps Embed API when a key is
 * configured; otherwise a clear fallback with coordinates and an external link.
 * Only ever rendered with data the API has already authorised for this viewer.
 */
export function LocationMap({ point, label, className, height = 220 }: { point: GeoPoint; label?: string; className?: string; height?: number }) {
  const q = `${point.lat},${point.lng}`;
  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-card", className)}>
      {googleMapsKey ? (
        <iframe
          title={label ?? "Shared location"}
          src={`https://www.google.com/maps/embed/v1/place?key=${googleMapsKey}&q=${q}&zoom=16`}
          width="100%"
          height={height}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="block border-0"
        />
      ) : (
        <div className="relative grid place-items-center bg-[linear-gradient(135deg,hsl(var(--secondary)),hsl(var(--muted)))]" style={{ height }}>
          <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(hsl(var(--border))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px)] [background-size:28px_28px]" aria-hidden />
          <div className="relative text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-emergency text-white shadow-lg"><MapPin className="size-6" /></span>
            <p className="mt-2 font-mono text-xs text-muted-foreground">{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</p>
            <p className="text-[11px] text-muted-foreground">Map preview needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs">
        <span className="text-muted-foreground">
          Updated {timeAgo(point.capturedAt)}{point.accuracy ? ` · ±${point.accuracy} m` : ""}{point.source === "simulated" ? " · simulated" : ""}
        </span>
        <a href={mapsLink(point.lat, point.lng)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-semibold text-accent">
          Open in Maps <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}
