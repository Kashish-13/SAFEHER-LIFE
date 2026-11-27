"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { clientMode, emulatorHosts, firebaseConfig, isFirebaseClientConfigured } from "../config";
import { parseLoopbackHost } from "../mode";

let app: FirebaseApp | null = null;

/**
 * Emulator wiring must happen exactly once per page, before first use. The flags
 * live on globalThis so a hot-reloaded copy of this module doesn't connect twice
 * (the SDK throws if connectAuthEmulator runs after Auth has been used).
 */
const g = globalThis as unknown as { __safeherAuthEmulator?: boolean; __safeherFirestoreEmulator?: boolean };
const isEmulator = clientMode.mode === "emulator";

/** Re-checked at connect time: only ever a loopback host. resolveMode already refused anything else. */
function loopback(value: string): { host: string; port: number } {
  const parsed = parseLoopbackHost(value);
  if (!parsed) throw new Error("Refusing to connect: emulator host must be on localhost, 127.0.0.1 or ::1");
  return parsed;
}

/** Returns the Firebase web app, or null in demo mode. */
export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseClientConfigured) return null;
  if (!app) app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const a = getFirebaseApp();
  if (!a) return null;
  const auth = getAuth(a);
  if (isEmulator && !g.__safeherAuthEmulator) {
    const { host, port } = loopback(emulatorHosts.auth);
    const origin = host.includes(":") ? `[${host}]` : host;
    // Our own "Local emulator, test data only" banner replaces the SDK's injected footer.
    connectAuthEmulator(auth, `http://${origin}:${port}`, { disableWarnings: true });
    g.__safeherAuthEmulator = true;
  }
  return auth;
}

/** Browser Firestore. Read-only listeners on the user's own data arrive in Phase 1 step E8. */
export function getFirebaseDb(): Firestore | null {
  const a = getFirebaseApp();
  if (!a) return null;
  const db = getFirestore(a);
  if (isEmulator && !g.__safeherFirestoreEmulator) {
    const { host, port } = loopback(emulatorHosts.firestore);
    connectFirestoreEmulator(db, host, port);
    g.__safeherFirestoreEmulator = true;
  }
  return db;
}
