import { NextResponse } from "next/server";
import { usesFirebase } from "@/lib/mode";
import { getServerMode } from "@/server/env";

/**
 * Public health/configuration probe. Never exposes secret values, only booleans
 * and the resolved mode. Missing variable NAMES are shown outside production only
 * (and always in emulator mode, which is local-only by construction).
 */
export async function GET() {
  const { mode, problems } = getServerMode();
  const firebaseSdk = usesFirebase(mode);
  const showProblems = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "true";
  return NextResponse.json(
    {
      status: mode === "misconfigured" ? "error" : "ok",
      mode,
      ...(showProblems && problems.length ? { problems } : {}),
      integrations: {
        firebaseAdmin: firebaseSdk,
        // True only for the local Firebase Emulator Suite (offline demo- project, test data only).
        emulator: mode === "emulator",
        // Server-side sending only, and never in emulator mode (FCM is not emulated).
        pushSending: mode === "firebase",
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
