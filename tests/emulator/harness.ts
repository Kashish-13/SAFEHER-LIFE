/**
 * Shared setup for tests that talk to the LOCAL Firestore emulator.
 * Run them only through `npm run test:emulator` (firebase emulators:exec), which starts a
 * throwaway emulator, sets FIRESTORE_EMULATOR_HOST, runs the tests and shuts it down.
 *
 * Safety: refuses to run unless the emulator host is loopback and the project is the
 * offline-only `demo-safeher-life`. No credential is used; data is wiped only through the
 * emulator's own local reset endpoint.
 */
import { deleteApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { parseLoopbackHost } from "@/lib/mode";

export const EMULATOR_PROJECT_ID = "demo-safeher-life";

export function assertLocalEmulator(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST;
  const parsed = parseLoopbackHost(raw);
  if (!parsed) {
    throw new Error("Refusing to run: FIRESTORE_EMULATOR_HOST must be a loopback emulator address. Use `npm run test:emulator`.");
  }
  const project = process.env.GCLOUD_PROJECT;
  if (project && project !== EMULATOR_PROJECT_ID) throw new Error(`Refusing to run: GCLOUD_PROJECT must be ${EMULATOR_PROJECT_ID}`);
  for (const k of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_ADMIN_PRIVATE_KEY", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_TOKEN"]) {
    if (process.env[k]) throw new Error(`Refusing to run: ${k} is set`);
  }
  return parsed;
}

let app: App | null = null;
let db: Firestore | null = null;

/** Firestore client bound to the local emulator (project id only, no credential). */
export function emulatorDb(): Firestore {
  assertLocalEmulator();
  if (!db) {
    app = initializeApp({ projectId: EMULATOR_PROJECT_ID }, `e4-store-tests-${process.pid}`);
    db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true }); // same setting as src/server/firebase-admin.ts
  }
  return db;
}

/** Deletes every document in the local emulator database (emulator-only REST endpoint). */
export async function clearEmulator() {
  const { host, port } = assertLocalEmulator();
  const origin = host.includes(":") ? `[${host}]` : host;
  const res = await fetch(`http://${origin}:${port}/emulator/v1/projects/${EMULATOR_PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Emulator reset failed: HTTP ${res.status}`);
}

export async function closeEmulatorApps() {
  await Promise.all(getApps().map((a) => deleteApp(a)));
  app = null;
  db = null;
}
