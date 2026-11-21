import { describe, expect, it } from "vitest";
import { ADMIN_FIREBASE_VARS, CLIENT_FIREBASE_VARS, resolveMode } from "@/lib/mode";
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

describe("0.8 safe post-login redirects", () => {
  it("keeps in-app paths such as invitation links", () => {
    expect(safeRedirect("/invite/abc123")).toBe("/invite/abc123");
  });
  it("rejects open redirects", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "", null]) expect(safeRedirect(bad)).toBe("/dashboard");
  });
});
