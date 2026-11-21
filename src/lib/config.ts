/**
 * Client-side configuration. Only NEXT_PUBLIC_* values are available here and
 * none of them are secrets (Firebase web config is protected by Security Rules).
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

export const isFirebaseClientConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/** Demo mode on the client mirrors the server rule in src/server/env.ts. */
export const isDemoClient =
  !isFirebaseClientConfigured && (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEMO_MODE === "true");

export const googleMapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
