import "server-only";
import { isFirebaseAdminConfigured } from "../env";
import { adminDb } from "../firebase-admin";
import { FirestoreStore } from "./firestore";
import { MemoryStore } from "./memory";
import type { DataStore } from "./types";

/**
 * Process-wide store singleton. Cached on globalThis so Next.js dev hot-reloads
 * don't wipe demo data on every edit.
 */
const g = globalThis as unknown as { __safeherStore?: DataStore; __safeherSeeded?: Promise<void> };

export function getStore(): DataStore {
  if (!g.__safeherStore) {
    g.__safeherStore = isFirebaseAdminConfigured() ? new FirestoreStore(adminDb()) : new MemoryStore();
  }
  return g.__safeherStore;
}

/** Ensures demo data is seeded exactly once per process (no-op in Firebase mode). */
export async function ensureSeeded(): Promise<void> {
  if (isFirebaseAdminConfigured()) return;
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
