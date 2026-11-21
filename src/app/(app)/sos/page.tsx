"use client";

import { Phone, Settings } from "lucide-react";
import Link from "next/link";
import { SosButton } from "@/components/sos/sos-button";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export default function SosPage() {
  const { profile } = useAuth();
  const p = profile!.emergencyPreferences;
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center py-6 text-center">
      <h1 className="sr-only">Emergency SOS</h1>
      <SosButton />
      <p className="mt-8 max-w-sm text-sm text-muted-foreground">
        {p.cancelWindowSeconds > 0 ? `You'll have ${p.cancelWindowSeconds} seconds to cancel. ` : "Alerts are sent immediately. "}
        {p.shareLocationOnSOS ? "Your current location will be included if available." : "Location will not be shared."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button asChild variant="emergency" size="lg"><a href="tel:112"><Phone /> Call 112</a></Button>
        <Button asChild variant="ghost"><Link href="/settings/sos"><Settings /> SOS settings</Link></Button>
      </div>
      <p className="mt-8 max-w-md text-xs text-muted-foreground">
        SafeHer alerts your trusted contacts. It is not connected to police dispatch, and delivery depends on network connectivity.
      </p>
    </div>
  );
}
