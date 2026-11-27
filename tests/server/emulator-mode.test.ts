import { deleteApp, getApps } from "firebase-admin/app";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Any attempt to load the fictional demo data in emulator mode must be visible.
const { seedDemoData } = vi.hoisted(() => ({ seedDemoData: vi.fn() }));
vi.mock("@/server/demo/seed", () => ({ seedDemoData, DEMO_PERSONAS: [] }));

import { GET as healthGET } from "@/app/api/health/route";
import { GET as demoPersonasGET } from "@/app/api/demo/session/route";
import { assertServerConfigured, ConfigError, getServerMode, isDemoMode, isEmulatorMode, isFirebaseAdminConfigured, isFirebaseBackend } from "@/server/env";
import { adminMessaging, getAdminApp } from "@/server/firebase-admin";
import { ensureSeeded, getStore } from "@/server/store";
import { FirestoreStore } from "@/server/store/firestore";

/** The same placeholders and loopback hosts as .env.emulator. No credentials anywhere. */
const EMULATOR_ENV: Record<string, string> = {
  NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key-placeholder",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "localhost",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-safeher-life",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-safeher-life-placeholder-bucket",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:0000placeholder",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  GCLOUD_PROJECT: "demo-safeher-life",
};

const g = globalThis as unknown as { __safeherStore?: unknown; __safeherSeeded?: unknown };

beforeEach(() => {
  // vitest.config.ts forces demo mode for the rest of the suite; switch it off here.
  vi.stubEnv("SAFEHER_FORCE_DEMO", "");
  for (const [k, v] of Object.entries(EMULATOR_ENV)) vi.stubEnv(k, v);
  g.__safeherStore = undefined;
  g.__safeherSeeded = undefined;
  seedDemoData.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  g.__safeherStore = undefined;
  g.__safeherSeeded = undefined;
});

afterAll(async () => {
  await Promise.all(getApps().map((a) => deleteApp(a)));
});

describe("E3 emulator mode on the server", () => {
  it("resolves to emulator mode: Firebase backend, but never a real Firebase project and never demo", () => {
    expect(getServerMode()).toEqual({ mode: "emulator", problems: [] });
    expect(isEmulatorMode()).toBe(true);
    expect(isFirebaseBackend()).toBe(true);
    expect(isFirebaseAdminConfigured()).toBe(false);
    expect(isDemoMode()).toBe(false);
    expect(() => assertServerConfigured()).not.toThrow();
  });

  it("initialises the Admin SDK with the demo project id only: no service-account key, no bucket", () => {
    const app = getAdminApp();
    expect(app.options.projectId).toBe("demo-safeher-life");
    expect(app.options.serviceAccountId).toBeUndefined();
    expect(app.options.storageBucket).toBeUndefined();
    // We pass no credential; the SDK substitutes its lazy application-default placeholder
    // (never a certificate). With the emulator hosts set it is never asked for a token.
    expect(app.options.credential?.constructor.name).toBe("ApplicationDefaultCredential");
    expect(app.options.credential?.constructor.name).not.toBe("ServiceAccountCredential");
  });

  it("can never send push notifications (FCM is not emulated)", () => {
    expect(() => adminMessaging()).toThrow(/disabled in emulator mode/);
  });

  it("uses the Firestore store and never loads the demo data", async () => {
    expect(getStore()).toBeInstanceOf(FirestoreStore);
    await ensureSeeded();
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("keeps demo sign-in disabled (404)", async () => {
    const res = await demoPersonasGET(new Request("http://localhost:3200/api/demo/session") as never);
    expect(res.status).toBe(404);
  });

  it("/api/health reports emulator mode, with push sending off", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("emulator");
    expect(body.integrations).toMatchObject({ firebaseAdmin: true, emulator: true, pushSending: false, smsAlerts: false });
  });

  it("a credential next to emulator settings makes the server refuse every request", async () => {
    vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "SECRET-VALUE-123");
    expect(() => assertServerConfigured()).toThrow(ConfigError);
    const res = await healthGET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.mode).toBe("misconfigured");
    expect(JSON.stringify(body)).not.toContain("SECRET-VALUE-123");
  });

  it("demo mode still seeds the fictional data exactly as before", async () => {
    vi.unstubAllEnvs(); // back to the suite's forced demo mode, no emulator variables
    expect(getServerMode().mode).toBe("demo");
    await ensureSeeded();
    expect(seedDemoData).toHaveBeenCalledTimes(1);
  });
});
