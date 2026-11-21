import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { isFirebaseAdminConfigured, serverEnv } from "./env";

let app: App | null = null;

/** Lazily initialises the Firebase Admin SDK from environment variables. */
export function getAdminApp(): App {
  if (!isFirebaseAdminConfigured()) throw new Error("Firebase Admin SDK is not configured");
  if (app) return app;
  app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: serverEnv.firebaseProjectId,
        clientEmail: serverEnv.firebaseClientEmail,
        privateKey: serverEnv.firebasePrivateKey,
      }),
      storageBucket: serverEnv.storageBucket || undefined,
    });
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
export const adminMessaging = () => getMessaging(getAdminApp());
