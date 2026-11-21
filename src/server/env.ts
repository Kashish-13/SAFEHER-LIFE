import "server-only";

/**
 * Server runtime configuration and mode detection.
 *
 * - FIREBASE mode: Admin SDK credentials present → Firestore + Firebase Auth.
 * - DEMO mode:    no Admin credentials, and either development or an explicit
 *                 NEXT_PUBLIC_DEMO_MODE=true. Uses seeded, in-memory simulated data.
 *
 * Production without Firebase and without explicit demo opt-in fails closed.
 */
export const serverEnv = {
  firebaseProjectId: process.env.FIREBASE_ADMIN_PROJECT_ID ?? "",
  firebaseClientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? "",
  firebasePrivateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  cronSecret: process.env.CRON_SECRET ?? "",
  demoSecret: process.env.DEMO_SESSION_SECRET ?? "",
};

export function isFirebaseAdminConfigured(): boolean {
  if (process.env.SAFEHER_FORCE_DEMO === "true") return false;
  return Boolean(serverEnv.firebaseProjectId && serverEnv.firebaseClientEmail && serverEnv.firebasePrivateKey);
}

export function isDemoMode(): boolean {
  if (process.env.SAFEHER_FORCE_DEMO === "true") return true;
  if (isFirebaseAdminConfigured()) return false;
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

export function getDemoSecret(): string {
  if (serverEnv.demoSecret.length >= 32) return serverEnv.demoSecret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DEMO_SESSION_SECRET (min 32 chars) is required when demo mode is enabled in production");
  }
  return "safeher-local-development-only-secret-do-not-use";
}
