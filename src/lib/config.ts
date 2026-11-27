import { resolveMode, usesFirebase } from "./mode";

/**
 * Client-side configuration. Only NEXT_PUBLIC_* values are available here and
 * none of them are secrets (Firebase web config is protected by Security Rules).
 * Each variable must be referenced literally so Next.js can inline it.
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

export const clientMode = resolveMode(
  {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_FIREBASE_EMULATORS: process.env.NEXT_PUBLIC_FIREBASE_EMULATORS,
    NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
  },
  "client",
);

/** Firebase client SDK is used only when the client config is complete (real project or local emulator). */
export const isFirebaseClientConfigured = usesFirebase(clientMode.mode);

/** Local emulator hosts for the browser SDK (validated as loopback by resolveMode). */
export const emulatorHosts = {
  auth: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? "",
  firestore: process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? "",
};

export const googleMapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
