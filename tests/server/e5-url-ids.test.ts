/**
 * Phase 1 E5: unsafe ids in URL path segments get a generic 404 before any service or store
 * code runs, and never a 500 or an internal error message.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getEmergency } from "@/app/api/emergencies/[id]/route";
import { GET as getInvitation } from "@/app/api/invitations/[token]/route";
import { freshStore, params, req } from "../support/setup";

beforeEach(async () => {
  await freshStore();
});

const UNSAFE = ["../users/demo_admin", "a/b", "sos_demo_past/x/y", ".", "..", "__name__", "x".repeat(1501)];

describe("URL id validation", () => {
  it("unsafe emergency ids → 404 with a generic message", async () => {
    for (const id of UNSAFE) {
      const res = await getEmergency(req("GET", "/api/emergencies/x", { as: "demo_priya" }), params({ id }));
      expect(res.status, id).toBe(404);
      const body = await res.json();
      expect(body.error).toEqual({ code: "not_found", message: "Not found" });
      expect(JSON.stringify(body), id).not.toMatch(/store|invalid_argument|Document id|firestore/i);
    }
  });

  it("unsafe invitation tokens → 404 with a generic message", async () => {
    for (const token of ["../x", "a/b", ".."]) {
      const res = await getInvitation(req("GET", "/api/invitations/x", { as: "demo_anita" }), params({ token }));
      expect(res.status, token).toBe(404);
      expect((await res.json()).error.code).toBe("not_found");
    }
  });

  it("valid ids are unaffected: existing → 200, unknown → the service's own 404", async () => {
    const ok = await getEmergency(req("GET", "/api/emergencies/x", { as: "demo_priya" }), params({ id: "sos_demo_past" }));
    expect(ok.status).toBe(200);
    const missing = await getEmergency(req("GET", "/api/emergencies/x", { as: "demo_priya" }), params({ id: "sos_does_not_exist" }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.message).toBe("Emergency not found");
  });

  it("authentication still comes first (no id probing without signing in)", async () => {
    const res = await getEmergency(req("GET", "/api/emergencies/x"), params({ id: "../users/demo_admin" }));
    expect(res.status).toBe(401);
  });
});
