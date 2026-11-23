import "server-only";
import { resolveMode, usesFirebase, type ModeResult } from "@/lib/mode";

/**
 * Server runtime configuration. Mode rules live in src/lib/mode.ts and are
 * shared with the browser so both sides always agree.
 */
export const serverEnv = {
  get firebaseProjectId() { return process.env.FIREBASE_ADMIN_PROJECT_ID ?? ""; },
  get firebaseClientEmail() { return process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? ""; },
  get firebasePrivateKey() { return (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"); },
  get storageBucket() { return process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? ""; },
  /** Emulator mode only: the offline "demo-*" project id. */
  get emulatorProjectId() { return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? ""; },
  get appUrl() { return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"; },
  get cronSecret() { return process.env.CRON_SECRET ?? ""; },
  get demoSecret() { return process.env.DEMO_SESSION_SECRET ?? ""; },
};

export class ConfigError extends Error {
  constructor(public problems: string[]) {
    super(`SafeHer server is misconfigured: ${problems.join(" | ")}`);
    this.name = "ConfigError";
  }
}

/** Not cached: tests change the environment between cases. Cheap to compute. */
export function getServerMode(): ModeResult {
  return resolveMode(process.env, "server");
}

/** Throws if the deployment is misconfigured. Called on every API request. */
export function assertServerConfigured(): void {
  const { mode, problems } = getServerMode();
  if (mode === "misconfigured") throw new ConfigError(problems);
}

/**
 * Real Firebase project with Admin credentials. Gates anything that would leave
 * this machine (e.g. FCM push), which is never allowed in emulator mode.
 */
export function isFirebaseAdminConfigured(): boolean {
  return getServerMode().mode === "firebase";
}

/** Local Firebase Emulator Suite (offline "demo-*" project, loopback hosts). */
export function isEmulatorMode(): boolean {
  return getServerMode().mode === "emulator";
}

/** Uses the Firebase SDKs and Firestore store: a real project OR the local emulator. */
export function isFirebaseBackend(): boolean {
  return usesFirebase(getServerMode().mode);
}

export function isDemoMode(): boolean {
  return getServerMode().mode === "demo";
}

export function getDemoSecret(): string {
  if (serverEnv.demoSecret.length >= 32) return serverEnv.demoSecret;
  if (process.env.NODE_ENV === "production") {
    throw new ConfigError(["DEMO_SESSION_SECRET (min 32 chars) is required when demo mode is enabled in production"]);
  }
  return "safeher-local-development-only-secret-do-not-use";
}
