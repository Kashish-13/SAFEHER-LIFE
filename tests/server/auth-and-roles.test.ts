import { beforeEach, describe, expect, it } from "vitest";
import { GET as adminStats } from "@/app/api/admin/stats/route";
import { PATCH as adminUpdateUser } from "@/app/api/admin/users/[id]/route";
import { GET as me } from "@/app/api/me/route";
import { POST as demoLogin } from "@/app/api/demo/session/route";
import { signDemoToken, verifyDemoToken } from "@/server/demo-token";
import { freshStore, params, req } from "../support/setup";

beforeEach(freshStore);

describe("authentication", () => {
  it("rejects requests without a token", async () => {
    expect((await me(req("GET", "/api/me"), params())).status).toBe(401);
  });

  it("rejects tampered and malformed tokens", async () => {
    const token = signDemoToken("demo_priya");
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A") + token.slice(-1);
    expect(verifyDemoToken(tampered)).toBeNull();
    expect(verifyDemoToken("demo.garbage")).toBeNull();
    expect((await me(req("GET", "/api/me", { token: tampered }), params())).status).toBe(401);
  });

  it("rejects expired tokens", () => {
    expect(verifyDemoToken(signDemoToken("demo_priya", -10))).toBeNull();
  });

  it("issues demo sessions only for known personas", async () => {
    const ok = await demoLogin(req("POST", "/api/demo/session", { body: { personaId: "demo_priya" } }));
    expect(ok.status).toBe(200);
    const bad = await demoLogin(req("POST", "/api/demo/session", { body: { personaId: "demo_nobody" } }));
    expect(bad.status).toBe(400);
  });

  it("returns the caller's own profile", async () => {
    const res = await me(req("GET", "/api/me", { as: "demo_priya" }), params());
    const body = await res.json();
    expect(body.profile.fullName).toBe("Priya Sharma");
  });
});

describe("rate limiting", () => {
  it("authenticated traffic does not consume the public sign-in budget", async () => {
    const { GET: status } = await import("@/app/api/status/route");
    for (let i = 0; i < 12; i++) await status(req("GET", "/api/status", { as: "demo_priya" }), params());
    const ok = await demoLogin(req("POST", "/api/demo/session", { body: { personaId: "demo_anita" } }));
    expect(ok.status).toBe(200);
  });

  it("public sign-in is still limited to 10 per minute per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await demoLogin(req("POST", "/api/demo/session", { body: { personaId: "demo_anita" } }))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("role-based authorization (enforced server-side)", () => {
  it("blocks non-admins from admin endpoints", async () => {
    expect((await adminStats(req("GET", "/api/admin/stats", { as: "demo_priya" }), params())).status).toBe(403);
  });

  it("allows admins", async () => {
    const res = await adminStats(req("GET", "/api/admin/stats", { as: "demo_admin" }), params());
    expect(res.status).toBe(200);
    expect((await res.json()).stats.users).toBeGreaterThan(0);
  });

  it("prevents a user from escalating their own role", async () => {
    const res = await adminUpdateUser(req("PATCH", "/api/admin/users/demo_priya", { as: "demo_priya", body: { roles: ["admin"] } }), params({ id: "demo_priya" }));
    expect(res.status).toBe(403);
  });

  it("disabled accounts are locked out", async () => {
    await adminUpdateUser(req("PATCH", "/api/admin/users/demo_meera", { as: "demo_admin", body: { roles: ["user"], disabled: true } }), params({ id: "demo_meera" }));
    expect((await me(req("GET", "/api/me", { as: "demo_meera" }), params())).status).toBe(403);
  });

  it("admins cannot remove their own admin role", async () => {
    const res = await adminUpdateUser(req("PATCH", "/api/admin/users/demo_admin", { as: "demo_admin", body: { roles: ["user"] } }), params({ id: "demo_admin" }));
    expect(res.status).toBe(400);
  });
});
