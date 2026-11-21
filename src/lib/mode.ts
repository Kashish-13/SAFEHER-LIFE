/**
 * Single source of truth for which mode SafeHer runs in. Pure and shared by the
 * browser (which can only see NEXT_PUBLIC_* values) and the server.
 *
 *  - "firebase":      complete Firebase configuration → real accounts and data.
 *  - "demo":          NO Firebase configuration and (development, or explicit
 *                     NEXT_PUBLIC_DEMO_MODE=true) → fictional, simulated data.
 *  - "unconfigured":  production with nothing configured → no sign-in possible.
 *  - "misconfigured": partial Firebase config, or demo mixed with Firebase →
 *                     the app refuses to run rather than half-working.
 *
 * Demo and Firebase can never be active at the same time.
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

export type AppMode = "firebase" | "demo" | "unconfigured" | "misconfigured";
export interface ModeResult {
  mode: AppMode;
  /** Human-readable problems. Contain variable NAMES only, never values. */
  problems: string[];
}

type Env = Record<string, string | undefined>;

export function resolveMode(env: Env, side: "server" | "client"): ModeResult {
  const has = (k: string) => Boolean(env[k]?.trim());
  const prod = env.NODE_ENV === "production";
  const demoFlag = env.NEXT_PUBLIC_DEMO_MODE === "true";
  const forceDemo = env.SAFEHER_FORCE_DEMO === "true";
  const problems: string[] = [];

  if (forceDemo) {
    if (prod) return { mode: "misconfigured", problems: ["SAFEHER_FORCE_DEMO is for automated tests only and must not be set in production"] };
    return { mode: "demo", problems: [] };
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
