import { NextResponse } from "next/server";
import { isDemoMode, isFirebaseAdminConfigured } from "@/server/env";

/** Public health/configuration probe. Never exposes secrets — only booleans. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    mode: isFirebaseAdminConfigured() ? "firebase" : isDemoMode() ? "demo" : "unconfigured",
    integrations: {
      firebaseAdmin: isFirebaseAdminConfigured(),
      pushNotifications: isFirebaseAdminConfigured() && Boolean(process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY),
      googleMaps: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
      smsAlerts: false,
      voiceRooms: false,
    },
    time: new Date().toISOString(),
  });
}
