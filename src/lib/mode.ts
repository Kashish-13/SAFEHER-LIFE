/**
 * Single source of truth for which mode SafeHer runs in. Pure and shared by the
 * browser (which can only see NEXT_PUBLIC_* values) and the server.
 *
 *  - "firebase":      complete Firebase configuration → real accounts and data.
 *  - "demo":          NO Firebase configuration and (development, or explicit
 *                     NEXT_PUBLIC_DEMO_MODE=true) → fictional, simulated data.
 *  - "unconfigured":  production with nothing configured → no sign-in possible.
 *  - "emulator":      local Firebase Emulator Suite only (Phase 1). Requires the
 *                     explicit flag, an offline-only "demo-*" project id and
 *                     loopback emulator hosts. Never real accounts or data.
 *  - "misconfigured": partial Firebase config, or demo mixed with Firebase →
 *                     the app refuses to run rather than half-working.
 *
 * Demo, emulator and Firebase can never be active at the same time.
 */
export const CLIENT_FIREBASE_VARS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

export const ADMIN_FIREBASE_VARS = ["FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_ADMIN_PRIVATE_KEY"] as const;

/** Server-side emulator host variables, read by the Firebase Admin SDK itself. */
export const SERVER_EMULATOR_HOST_VARS = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"] as const;
/** Browser copies of the same hosts (the browser can't see server-only variables). */
export const CLIENT_EMULATOR_HOST_VARS = ["NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST"] as const;
/** Any of these present means real credentials are reachable, so emulator mode is refused. */
export const CREDENTIAL_VARS = [...ADMIN_FIREBASE_VARS, "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_TOKEN", "FIREBASE_SERVICE_ACCOUNT"] as const;

export type AppMode = "firebase" | "emulator" | "demo" | "unconfigured" | "misconfigured";
export interface ModeResult {
  mode: AppMode;
  /** Human-readable problems. Contain variable NAMES only, never values. */
  problems: string[];
}

/** True for modes that use the Firebase SDKs (real project or local emulator). */
export const usesFirebase = (mode: AppMode): boolean => mode === "firebase" || mode === "emulator";

type Env = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEMO_PROJECT_ID = /^demo-[a-z0-9-]+$/;

/** Parses "host:port" (IPv6 as "[::1]:port"). Returns null unless the host is loopback and the port valid. */
export function parseLoopbackHost(value: string | undefined): { host: string; port: number } | null {
  const m = /^(?:\[([^\]]+)\]|([^:[\]]+)):(\d{1,5})$/.exec(value?.trim() ?? "");
  if (!m) return null;
  const host = (m[1] ?? m[2]).toLowerCase();
  const port = Number(m[3]);
  if (!LOOPBACK_HOSTS.has(host) || port < 1 || port > 65535) return null;
  return { host, port };
}

function resolveEmulatorMode(env: Env, side: "server" | "client", has: (k: string) => boolean): ModeResult {
  const problems: string[] = [];
  if (env.NEXT_PUBLIC_DEMO_MODE === "true" || env.SAFEHER_FORCE_DEMO === "true") {
    problems.push("Emulator mode cannot be combined with demo mode (NEXT_PUBLIC_DEMO_MODE / SAFEHER_FORCE_DEMO). Remove one of them.");
  }
  const missingClient = CLIENT_FIREBASE_VARS.filter((k) => !has(k));
  if (missingClient.length) problems.push(`Incomplete emulator configuration. Missing: ${missingClient.join(", ")}`);

  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "";
  if (projectId && !DEMO_PROJECT_ID.test(projectId)) {
    problems.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID must be an offline-only project id starting with "demo-" in emulator mode');
  }

  const hostVars = side === "server" ? [...SERVER_EMULATOR_HOST_VARS, ...CLIENT_EMULATOR_HOST_VARS] : [...CLIENT_EMULATOR_HOST_VARS];
  for (const k of hostVars) {
    if (!has(k)) problems.push(`${k} is required in emulator mode`);
    else if (!parseLoopbackHost(env[k])) problems.push(`${k} must be host:port on localhost, 127.0.0.1 or ::1`);
  }

  if (side === "server") {
    if (has("VERCEL")) problems.push("Emulator mode is refused on Vercel (VERCEL is set)");
    const creds = CREDENTIAL_VARS.filter(has);
    if (creds.length) problems.push(`Emulator mode is refused while credential variables are set: ${creds.join(", ")}`);
    if (has("GCLOUD_PROJECT") && env.GCLOUD_PROJECT?.trim() !== projectId) {
      problems.push("GCLOUD_PROJECT must equal NEXT_PUBLIC_FIREBASE_PROJECT_ID in emulator mode");
    }
    // The browser and the server must talk to the same emulators.
    const pairs = [["FIRESTORE_EMULATOR_HOST", "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST"], ["FIREBASE_AUTH_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST"]] as const;
    for (const [s, c] of pairs) {
      if (has(s) && has(c) && env[s]!.trim() !== env[c]!.trim()) problems.push(`${c} must equal ${s}`);
    }
  }
  return problems.length ? { mode: "misconfigured", problems } : { mode: "emulator", problems: [] };
}

export function resolveMode(env: Env, side: "server" | "client"): ModeResult {
  const has = (k: string) => Boolean(env[k]?.trim());
  const prod = env.NODE_ENV === "production";
  const demoFlag = env.NEXT_PUBLIC_DEMO_MODE === "true";
  const forceDemo = env.SAFEHER_FORCE_DEMO === "true";
  const problems: string[] = [];

  // Explicit opt-in only. Evaluated first so nothing else can mix with it.
  if (env.NEXT_PUBLIC_FIREBASE_EMULATORS === "true") return resolveEmulatorMode(env, side, has);

  if (forceDemo) {
    if (prod) return { mode: "misconfigured", problems: ["SAFEHER_FORCE_DEMO is for automated tests only and must not be set in production"] };
    return { mode: "demo", problems: [] };
  }

  // Emulator hosts without the explicit flag would silently redirect the Admin SDK. Refuse.
  const strayHosts = [...(side === "server" ? SERVER_EMULATOR_HOST_VARS : []), ...CLIENT_EMULATOR_HOST_VARS].filter(has);
  if (strayHosts.length) {
    return { mode: "misconfigured", problems: [`Emulator host variables are set (${strayHosts.join(", ")}) but NEXT_PUBLIC_FIREBASE_EMULATORS is not "true". Set it or remove them.`] };
  }

  const clientSet = CLIENT_FIREBASE_VARS.filter(has);
  const adminSet = side === "server" ? ADMIN_FIREBASE_VARS.filter(has) : [];
  const anyFirebase = clientSet.length > 0 || adminSet.length > 0;

  if (anyFirebase) {
    const missing = [
      ...CLIENT_FIREBASE_VARS.filter((k) => !has(k)),
      ...(side === "server" ? ADMIN_FIREBASE_VARS.filter((k) => !has(k)) : []),
    ];
    if (missing.length) problems.push(`Incomplete Firebase configuration. Missing: ${missing.join(", ")}`);
    if (demoFlag) problems.push("NEXT_PUBLIC_DEMO_MODE=true cannot be combined with Firebase configuration. Remove one of them.");
    return problems.length ? { mode: "misconfigured", problems } : { mode: "firebase", problems: [] };
  }

  if (!prod || demoFlag) {
    if (prod && side === "server" && (env.DEMO_SESSION_SECRET?.length ?? 0) < 32) {
      return { mode: "misconfigured", problems: ["DEMO_SESSION_SECRET (at least 32 characters) is required for demo mode in production"] };
    }
    return { mode: "demo", problems: [] };
  }
  return { mode: "unconfigured", problems: [] };
}
