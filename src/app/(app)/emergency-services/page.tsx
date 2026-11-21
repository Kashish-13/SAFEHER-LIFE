"use client";

import { Building2, Cross, ExternalLink, LocateFixed, Phone, Shield } from "lucide-react";
import { useState } from "react";
import { INDIA_EMERGENCY_NUMBERS } from "@/core/defaults";
import type { GeoPoint } from "@/core/types";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { useGeolocation } from "@/hooks/use-geolocation";
import { googleMapsKey } from "@/lib/config";

const PLACES = [
  { q: "hospital", label: "Hospitals", icon: Cross },
  { q: "police station", label: "Police stations", icon: Shield },
  { q: "pharmacy", label: "24h pharmacies", icon: Building2 },
];

export default function EmergencyServicesPage() {
  const { getCurrent, permission } = useGeolocation();
  const [loc, setLoc] = useState<GeoPoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState(PLACES[0]);
  const [error, setError] = useState<string | null>(null);

  const locate = async () => {
    setBusy(true); setError(null);
    const p = await getCurrent();
    if (!p) setError("Couldn't get your location. Allow location access, or search manually in Maps.");
    setLoc(p); setBusy(false);
  };

  const searchUrl = (q: string) => loc
    ? `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${loc.lat},${loc.lng},15z`
    : `https://www.google.com/maps/search/${encodeURIComponent(q + " near me")}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Emergency services" description="Dial directly from your phone. SafeHer is not connected to police dispatch." />

      <a href="tel:112" className="flex items-center justify-between gap-4 rounded-3xl bg-gradient-to-br from-[hsl(356_78%_52%)] to-[hsl(345_70%_40%)] p-6 text-white shadow-sos sm:p-8">
        <div>
          <p className="text-sm font-semibold opacity-90">India National Emergency Number</p>
          <p className="font-display text-5xl font-extrabold sm:text-6xl">112</p>
          <p className="mt-1 text-sm opacity-90">Police · Fire · Ambulance. Tap to call.</p>
        </div>
        <span className="grid size-16 shrink-0 place-items-center rounded-full bg-white/20 sm:size-20"><Phone className="size-8 sm:size-10" /></span>
      </a>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader><CardTitle>Helplines</CardTitle></CardHeader>
          <CardContent className="divide-y pt-0">
            {INDIA_EMERGENCY_NUMBERS.filter((n) => !n.primary).map((n) => (
              <a key={n.number} href={`tel:${n.number}`} className="flex items-center justify-between gap-3 py-3.5 hover:opacity-80">
                <div><p className="text-lg font-bold">{n.number}</p><p className="text-sm text-muted-foreground">{n.label}</p></div>
                <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary"><Phone className="size-4" /></span>
              </a>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Nearby help</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {PLACES.map((p) => (
                <Button key={p.q} size="sm" variant={place.q === p.q ? "default" : "outline"} onClick={() => setPlace(p)}><p.icon />{p.label}</Button>
              ))}
            </div>
            {!loc ? (
              <div className="space-y-3 rounded-xl bg-secondary/60 p-4 text-sm">
                <p className="text-muted-foreground">Use your location to find the nearest {place.label.toLowerCase()}. It&apos;s used only on this device for the map search and is not saved.</p>
                <Button onClick={locate} loading={busy} disabled={permission === "unsupported"}><LocateFixed />Use my location</Button>
              </div>
            ) : googleMapsKey ? (
              <iframe title={`Nearby ${place.label}`} className="block h-72 w-full rounded-xl border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                src={`https://www.google.com/maps/embed/v1/search?key=${googleMapsKey}&q=${encodeURIComponent(place.q)}&center=${loc.lat},${loc.lng}&zoom=14`} />
            ) : (
              <Alert tone="neutral" title="Map preview unavailable">Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to show an embedded map. You can still open the search in Google Maps.</Alert>
            )}
            {error && <Alert tone="warning">{error}</Alert>}
            <Button asChild variant="outline" className="w-full"><a href={searchUrl(place.q)} target="_blank" rel="noopener noreferrer"><ExternalLink />Open {place.label.toLowerCase()} in Google Maps</a></Button>
          </CardContent>
        </Card>
      </div>
      <p className="text-center text-xs text-muted-foreground">Nearby results come from Google Maps and may be incomplete or out of date. In an emergency, call 112.</p>
    </div>
  );
}
