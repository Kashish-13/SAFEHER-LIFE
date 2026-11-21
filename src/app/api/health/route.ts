import { NextResponse } from "next/server";
import { getServerMode } from "@/server/env";

/**
 * Public health/configuration probe. Never exposes secret values, only booleans
 * and the resolved mode. Missing variable NAMES are shown outside production only.
 */
export async function GET() {
  const { mode, problems } = getServerMode();
  const firebase = mode === "firebase";
  return NextResponse.json(
    {
      status: mode === "misconfigured" ? "error" : "ok",
      mode,
      ...(process.env.NODE_ENV !== "production" && problems.length ? { problems } : {}),
      integrations: {
        firebaseAdmin: firebase,
        // Server-side sending only. Browser device registration arrives in Phase 1.
        pushSending: firebase,
        webPushRegistration: false,
        googleMaps: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
        smsAlerts: false,
        voiceRooms: false,
        reliableScheduler: false,
      },
      time: new Date().toISOString(),
    },
    { status: mode === "misconfigured" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
