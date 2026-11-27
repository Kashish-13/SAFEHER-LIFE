import "server-only";
import { isDemoMode, isFirebaseBackend } from "../env";
import { adminDb } from "../firebase-admin";
import { FirestoreStore } from "./firestore";
import { MemoryStore } from "./memory";
import type { DataStore } from "./types";

/**
 * Process-wide store singleton. Cached on globalThis so Next.js dev hot-reloads
 * don't wipe demo data on every edit.
 *  - Firebase and emulator modes: Firestore (the emulator via FIRESTORE_EMULATOR_HOST).
 *  - Everything else: in-memory.
 */
const g = globalThis as unknown as { __safeherStore?: DataStore; __safeherSeeded?: Promise<void> };

export function getStore(): DataStore {
  if (!g.__safeherStore) {
    g.__safeherStore = isFirebaseBackend() ? new FirestoreStore(adminDb()) : new MemoryStore();
  }
  return g.__safeherStore;
}

/** Seeds the fictional demo data exactly once per process, and ONLY in demo mode (never Firebase/emulator). */
export async function ensureSeeded(): Promise<void> {
  if (!isDemoMode()) return;
  if (!g.__safeherSeeded) {
    g.__safeherSeeded = import("../demo/seed").then((m) => m.seedDemoData(getStore()));
  }
  return g.__safeherSeeded;
}

/** Test helper: replace the store (e.g. fresh MemoryStore per test). */
export function __setStoreForTests(store: DataStore) {
  g.__safeherStore = store;
  g.__safeherSeeded = Promise.resolve();
}
