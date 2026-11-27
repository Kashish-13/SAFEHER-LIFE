import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { isEmulatorMode, isFirebaseAdminConfigured, isFirebaseBackend, serverEnv } from "./env";

let app: App | null = null;

/**
 * Lazily initialises the Firebase Admin SDK.
 *  - Firebase mode: service-account credentials from environment variables.
 *  - Emulator mode: project id ONLY; we pass no credential. The SDK then fills in
 *    its lazy "application default" placeholder (Admin Firestore refuses to start
 *    without one), but never asks it for a token: with FIRESTORE_EMULATOR_HOST and
 *    FIREBASE_AUTH_EMULATOR_HOST set (validated as loopback by resolveMode) both
 *    services talk to the local emulators with the emulator's fixed "owner" token.
 *    resolveMode also refuses emulator mode while any credential variable exists,
 *    and the launcher disables Google metadata-server detection.
 */
export function getAdminApp(): App {
  if (!isFirebaseBackend()) throw new Error("Firebase Admin SDK is not configured");
  if (app) return app;
  app =
    getApps()[0] ??
    (isEmulatorMode()
      ? initializeApp({ projectId: serverEnv.emulatorProjectId })
      : initializeApp({
          credential: cert({
            projectId: serverEnv.firebaseProjectId,
            clientEmail: serverEnv.firebaseClientEmail,
            privateKey: serverEnv.firebasePrivateKey,
          }),
          storageBucket: serverEnv.storageBucket || undefined,
        }));
  return app;
}

export const adminAuth = () => getAuth(getAdminApp());
let dbConfigured = false;
export const adminDb = () => {
  const db = getFirestore(getAdminApp());
  if (!dbConfigured) {
    db.settings({ ignoreUndefinedProperties: true });
    dbConfigured = true;
  }
  return db;
};
/** FCM is not emulated: a real project is required, so emulator mode can never send push. */
export const adminMessaging = () => {
  if (!isFirebaseAdminConfigured()) throw new Error("Push messaging requires a real Firebase project; it is disabled in emulator mode");
  return getMessaging(getAdminApp());
};
