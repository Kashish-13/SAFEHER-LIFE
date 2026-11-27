#!/usr/bin/env node
// Runs SafeHer against the LOCAL Firebase Emulator Suite only.
//
//   node scripts/emulator-app.mjs check   validate the emulator setup, start nothing
//   node scripts/emulator-app.mjs dev     next dev   on http://localhost:3200
//   node scripts/emulator-app.mjs build   next build into .next-emu
//   node scripts/emulator-app.mjs start   next start on http://localhost:3200
//
// Safety: refuses to run unless every Firebase setting points at the emulator
// (project id "demo-*", loopback hosts) and no real credential is reachable.
// Uses its own port (3200) and build folder (.next-emu), so the demo dev server
// (3000) and the browser-test servers (3100, 3110) are never touched.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ID = "demo-safeher-life";
const PORT = "3200";
const DIST_DIR = ".next-emu";

// Emulator mode exists in the app since Phase 1 step E3 (src/lib/mode.ts), which
// re-checks every rule below on the server and in the browser.
const APP_SUPPORTS_EMULATOR = true;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const REQUIRED = [
  "NEXT_PUBLIC_FIREBASE_EMULATORS",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST",
  "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST",
  "GCLOUD_PROJECT",
  "NEXT_PUBLIC_APP_URL",
];
// Never allowed in emulator runs: real credentials, and demo-mode switches
// (demo and Firebase-style modes must never mix).
const FORBIDDEN = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "FIREBASE_CONFIG",
  "FIREBASE_TOKEN",
  "FIREBASE_SERVICE_ACCOUNT",
  "NEXT_PUBLIC_DEMO_MODE",
  "SAFEHER_FORCE_DEMO",
  "DEMO_SESSION_SECRET",
];
// Files Next.js loads automatically. If any of them holds Firebase settings they
// could leak into an emulator run, so we refuse instead of guessing.
const NEXT_ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"];

function parseEnvFile(path) {
  const out = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const hostOf = (hostPort) => {
  const m = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(hostPort ?? "");
  return m ? m[1] : "";
};

/** Returns a list of problems (variable NAMES only, never values). Empty = safe. */
function validate(env) {
  const problems = [];
  for (const k of REQUIRED) if (!env[k]) problems.push(`${k} is missing from .env.emulator`);
  for (const k of FORBIDDEN) if (env[k]) problems.push(`${k} must not be set in .env.emulator`);

  if (env.NEXT_PUBLIC_FIREBASE_EMULATORS !== "true") problems.push("NEXT_PUBLIC_FIREBASE_EMULATORS must be \"true\"");
  for (const k of ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", "GCLOUD_PROJECT"]) {
    if (env[k] && env[k] !== PROJECT_ID) problems.push(`${k} must be "${PROJECT_ID}" (an offline-only demo- project)`);
  }
  for (const k of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST"]) {
    if (env[k] && !LOOPBACK.has(hostOf(env[k]))) problems.push(`${k} must point at a loopback address (127.0.0.1 / localhost)`);
  }
  for (const [s, c] of [["FIRESTORE_EMULATOR_HOST", "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST"], ["FIREBASE_AUTH_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST"]]) {
    if (env[s] && env[c] && env[s] !== env[c]) problems.push(`${c} must equal ${s}`);
  }
  if (env.NEXT_PUBLIC_APP_URL) {
    try {
      const u = new URL(env.NEXT_PUBLIC_APP_URL);
      if (!LOOPBACK.has(u.hostname) || u.port !== PORT) problems.push(`NEXT_PUBLIC_APP_URL must be a loopback URL on port ${PORT}`);
    } catch {
      problems.push("NEXT_PUBLIC_APP_URL is not a valid URL");
    }
  }

  // The parent environment must not carry real credentials or deployment markers either.
  if (process.env.VERCEL) problems.push("Refusing to run emulator mode on Vercel (VERCEL is set)");
  for (const k of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_ADMIN_PRIVATE_KEY", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_TOKEN"]) {
    if (process.env[k]) problems.push(`${k} is set in your shell. Unset it before using the emulator`);
  }

  for (const f of NEXT_ENV_FILES) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    const vals = parseEnvFile(p);
    const risky = Object.keys(vals).filter((k) => vals[k] && (k.startsWith("NEXT_PUBLIC_FIREBASE_") || k.startsWith("FIREBASE_") || k === "GOOGLE_APPLICATION_CREDENTIALS"));
    if (risky.length) problems.push(`${f} sets Firebase variables (${risky.join(", ")}), which Next.js would load. Move them out before using the emulator`);
  }
  return problems;
}

const command = process.argv[2];
if (!["check", "dev", "build", "start"].includes(command ?? "")) {
  console.error("Usage: node scripts/emulator-app.mjs <check|dev|build|start>");
  process.exit(2);
}

const envPath = join(ROOT, ".env.emulator");
if (!existsSync(envPath)) {
  console.error("[emulator] .env.emulator not found.");
  process.exit(1);
}
const fileEnv = parseEnvFile(envPath);
const problems = validate(fileEnv);
if (problems.length) {
  console.error("[emulator] Refusing to start. Problems:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`[emulator] Configuration OK: project ${PROJECT_ID}, Firestore ${fileEnv.FIRESTORE_EMULATOR_HOST}, Auth ${fileEnv.FIREBASE_AUTH_EMULATOR_HOST}, app ${fileEnv.NEXT_PUBLIC_APP_URL}.`);

if (command === "check") process.exit(0);
if (!APP_SUPPORTS_EMULATOR) {
  console.error("[emulator] The app does not support emulator mode yet (Phase 1 step E3). Only `check` is available.");
  process.exit(1);
}

// Blank out anything that could select demo mode or real credentials. Next.js
// does not override variables that already exist in the environment.
const blanks = Object.fromEntries(FORBIDDEN.map((k) => [k, ""]));
// METADATA_SERVER_DETECTION=none: Google's auth library never probes the cloud metadata
// server (169.254.169.254) for credentials. Nothing should ask it to; this makes sure.
const childEnv = { ...process.env, ...blanks, ...fileEnv, NEXT_DIST_DIR: DIST_DIR, METADATA_SERVER_DETECTION: "none" };
const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
// Bind to loopback only: test-data builds must not be reachable from the local network.
// (Phone testing still works through USB port forwarding to localhost.)
const args = command === "build" ? ["build"] : [command, "-p", PORT, "-H", "127.0.0.1"];
const child = spawn(process.execPath, [nextBin, ...args], { cwd: ROOT, env: childEnv, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
