import { describe, expect, it } from "vitest";
import { ADMIN_FIREBASE_VARS, CLIENT_FIREBASE_VARS, CREDENTIAL_VARS, parseLoopbackHost, resolveMode, usesFirebase } from "@/lib/mode";
import { safeRedirect } from "@/lib/utils";

const fullClient = Object.fromEntries(CLIENT_FIREBASE_VARS.map((k) => [k, "x"]));
const fullAdmin = Object.fromEntries(ADMIN_FIREBASE_VARS.map((k) => [k, "x"]));

describe("0.2 mode guard: demo and production stay separate", () => {
  it("complete Firebase config → firebase", () => {
    expect(resolveMode({ NODE_ENV: "production", ...fullClient, ...fullAdmin }, "server").mode).toBe("firebase");
  });

  it("partial Firebase config → misconfigured, listing missing NAMES only", () => {
    const r = resolveMode({ NODE_ENV: "production", ...fullClient, FIREBASE_ADMIN_PROJECT_ID: "secret-value" }, "server");
    expect(r.mode).toBe("misconfigured");
    expect(r.problems[0]).toContain("FIREBASE_ADMIN_PRIVATE_KEY");
    expect(r.problems.join(" ")).not.toContain("secret-value");
  });

  it("browser keys without server keys is caught on the server", () => {
    expect(resolveMode({ NODE_ENV: "development", ...fullClient }, "server").mode).toBe("misconfigured");
  });

  it("demo mode can never be combined with Firebase", () => {
    expect(resolveMode({ NODE_ENV: "production", NEXT_PUBLIC_DEMO_MODE: "true", ...fullClient, ...fullAdmin }, "server").mode).toBe("misconfigured");
  });

  it("production with nothing configured → unconfigured (no fictional users)", () => {
    expect(resolveMode({ NODE_ENV: "production" }, "server").mode).toBe("unconfigured");
  });

  it("production demo requires explicit opt-in AND a strong secret", () => {
    expect(resolveMode({ NODE_ENV: "production", NEXT_PUBLIC_DEMO_MODE: "true" }, "server").mode).toBe("misconfigured");
    expect(resolveMode({ NODE_ENV: "production", NEXT_PUBLIC_DEMO_MODE: "true", DEMO_SESSION_SECRET: "a".repeat(32) }, "server").mode).toBe("demo");
  });

  it("the test-only override is refused in production", () => {
    expect(resolveMode({ NODE_ENV: "production", SAFEHER_FORCE_DEMO: "true" }, "server").mode).toBe("misconfigured");
  });

  it("development without config → demo; the browser ignores server-only vars", () => {
    expect(resolveMode({ NODE_ENV: "development" }, "server").mode).toBe("demo");
    expect(resolveMode({ NODE_ENV: "production", ...fullClient }, "client").mode).toBe("firebase");
  });
});

// ── Phase 1 E3: local Firebase Emulator mode ────────────────────────────────
const emuClient: Record<string, string> = {
  NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key-placeholder",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "localhost",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-safeher-life",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-safeher-life-placeholder-bucket",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:0000placeholder",
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
};
const emuServer: Record<string, string> = {
  ...emuClient,
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  GCLOUD_PROJECT: "demo-safeher-life",
};
const server = (extra: Record<string, string | undefined> = {}, nodeEnv = "development") =>
  resolveMode({ NODE_ENV: nodeEnv, ...emuServer, ...extra }, "server");
const client = (extra: Record<string, string | undefined> = {}) => resolveMode({ NODE_ENV: "production", ...emuClient, ...extra }, "client");

describe("E3 emulator mode: accepted configurations", () => {
  it("complete local config → emulator, on the server (dev AND local production build) and in the browser", () => {
    expect(server()).toEqual({ mode: "emulator", problems: [] });
    expect(server({}, "production")).toEqual({ mode: "emulator", problems: [] });
    expect(client()).toEqual({ mode: "emulator", problems: [] });
  });

  it("accepts localhost, 127.0.0.1 and ::1 (bracketed), case-insensitively", () => {
    for (const h of ["localhost:8080", "LOCALHOST:8080", "127.0.0.1:8080", "[::1]:8080"]) {
      expect(server({ FIRESTORE_EMULATOR_HOST: h, NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: h }).mode, h).toBe("emulator");
    }
  });

  it("emulator mode uses the Firebase SDKs; demo stays demo", () => {
    expect(usesFirebase("emulator")).toBe(true);
    expect(usesFirebase("firebase")).toBe(true);
    for (const m of ["demo", "unconfigured", "misconfigured"] as const) expect(usesFirebase(m)).toBe(false);
  });

  it("existing modes are unchanged when the emulator flag is absent", () => {
    expect(resolveMode({ NODE_ENV: "production", ...fullClient, ...fullAdmin }, "server").mode).toBe("firebase");
    expect(resolveMode({ NODE_ENV: "development" }, "server").mode).toBe("demo");
    expect(resolveMode({ NODE_ENV: "production" }, "server").mode).toBe("unconfigured");
    expect(resolveMode({ NODE_ENV: "development", NEXT_PUBLIC_FIREBASE_EMULATORS: "false" }, "server").mode).toBe("demo");
  });
});

describe("E3 emulator mode: every refusal condition", () => {
  it("requires the explicit flag to be exactly \"true\"; emulator hosts without it are refused", () => {
    for (const flag of ["1", "TRUE", "yes", "", undefined]) {
      expect(server({ NEXT_PUBLIC_FIREBASE_EMULATORS: flag }).mode, String(flag)).toBe("misconfigured");
    }
    expect(resolveMode({ NODE_ENV: "development", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, "server").mode).toBe("misconfigured");
    expect(resolveMode({ NODE_ENV: "development", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }, "server").mode).toBe("misconfigured");
    expect(resolveMode({ NODE_ENV: "production", NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, "client").mode).toBe("misconfigured");
    // A real Firebase setup can't be silently redirected to an emulator either.
    expect(resolveMode({ NODE_ENV: "production", ...fullClient, ...fullAdmin, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, "server").mode).toBe("misconfigured");
  });

  it("requires BOTH server host variables and BOTH browser host variables", () => {
    for (const k of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST"]) {
      const r = server({ [k]: undefined });
      expect(r.mode, k).toBe("misconfigured");
      expect(r.problems.join(" "), k).toContain(k);
    }
    for (const k of ["NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST"]) {
      expect(client({ [k]: undefined }).mode, k).toBe("misconfigured");
    }
  });

  it("requires the complete (placeholder) browser config", () => {
    for (const k of CLIENT_FIREBASE_VARS) {
      expect(server({ [k]: undefined }).mode, k).toBe("misconfigured");
      expect(client({ [k]: "" }).mode, k).toBe("misconfigured");
    }
  });

  it("accepts only project ids beginning with demo-", () => {
    for (const id of ["safeher-life", "safeher-life-prod", "demo", "demo-", "Demo-safeher", "demo_safeher", "prod-demo-x", "demo-SafeHer", "demo-x/../y"]) {
      expect(server({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: id, GCLOUD_PROJECT: id }).mode, id).toBe("misconfigured");
      expect(client({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: id }).mode, id).toBe("misconfigured");
    }
    expect(server({ GCLOUD_PROJECT: "safeher-life" }).mode).toBe("misconfigured");
    expect(server({ GCLOUD_PROJECT: undefined }).mode).toBe("emulator");
  });

  it("allows only localhost, 127.0.0.1 or ::1 hosts, with a valid port", () => {
    const bad = [
      "10.0.0.5:8080", "192.168.1.2:8080", "172.168.13.64:8080", "0.0.0.0:8080", "127.0.0.2:8080", "[::2]:8080", "::1:8080",
      "localhost.evil.com:8080", "evil.com:8080", "firestore.googleapis.com:443", "identitytoolkit.googleapis.com:443",
      "localhost", "127.0.0.1", "127.0.0.1:", "127.0.0.1:0", "127.0.0.1:70000", "localhost:abc", "http://127.0.0.1:8080", "127.0.0.1:8080/x",
    ];
    for (const v of bad) {
      for (const [s, c] of [["FIRESTORE_EMULATOR_HOST", "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST"], ["FIREBASE_AUTH_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST"]]) {
        expect(server({ [s]: v, [c]: v }).mode, `${s}=${v}`).toBe("misconfigured");
        expect(client({ [c]: v }).mode, `${c}=${v}`).toBe("misconfigured");
      }
    }
  });

  it("the browser and the server must point at the same emulators", () => {
    expect(server({ NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: "127.0.0.1:8081" }).mode).toBe("misconfigured");
    expect(server({ NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" }).mode).toBe("misconfigured");
  });

  it("is refused on Vercel", () => {
    expect(server({ VERCEL: "1" }).mode).toBe("misconfigured");
    expect(server({ VERCEL: "1" }, "production").problems.join(" ")).toContain("Vercel");
  });

  it("is refused together with demo mode (either switch), on both sides", () => {
    expect(server({ NEXT_PUBLIC_DEMO_MODE: "true" }).mode).toBe("misconfigured");
    expect(client({ NEXT_PUBLIC_DEMO_MODE: "true" }).mode).toBe("misconfigured");
    expect(server({ SAFEHER_FORCE_DEMO: "true" }).mode).toBe("misconfigured");
  });

  it("is refused while ANY credential or key variable is present", () => {
    for (const k of CREDENTIAL_VARS) {
      const r = server({ [k]: "SECRET-VALUE-123" });
      expect(r.mode, k).toBe("misconfigured");
      expect(r.problems.join(" "), k).toContain(k);
    }
    expect(CREDENTIAL_VARS).toEqual(expect.arrayContaining([...ADMIN_FIREBASE_VARS, "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_TOKEN"]));
  });

  it("problems name variables but never echo their values", () => {
    const r = server({ FIREBASE_ADMIN_PRIVATE_KEY: "SECRET-VALUE-123", FIRESTORE_EMULATOR_HOST: "10.9.9.9:8080", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "real-prod-project" });
    const text = r.problems.join(" ");
    for (const v of ["SECRET-VALUE-123", "10.9.9.9", "real-prod-project"]) expect(text).not.toContain(v);
  });
});

describe("E3 parseLoopbackHost", () => {
  it("parses loopback host:port and rejects everything else", () => {
    expect(parseLoopbackHost("127.0.0.1:8080")).toEqual({ host: "127.0.0.1", port: 8080 });
    expect(parseLoopbackHost("[::1]:9099")).toEqual({ host: "::1", port: 9099 });
    expect(parseLoopbackHost("LocalHost:4000")).toEqual({ host: "localhost", port: 4000 });
    for (const v of [undefined, "", "127.0.0.1", "example.com:80", "0.0.0.0:1", "127.0.0.1:65536"]) expect(parseLoopbackHost(v), String(v)).toBeNull();
  });
});

describe("0.8 safe post-login redirects", () => {
  it("keeps in-app paths such as invitation links", () => {
    expect(safeRedirect("/invite/abc123")).toBe("/invite/abc123");
  });
  it("rejects open redirects", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "", null]) expect(safeRedirect(bad)).toBe("/dashboard");
  });
});
