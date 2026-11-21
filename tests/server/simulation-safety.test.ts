import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmergencyEvent, UserProfile } from "@/core/types";
import { applyRetention, createEmergency } from "@/server/services/emergencies";
import { COLLECTIONS } from "@/server/store/types";
import { freshStore } from "../support/setup";

let store: Awaited<ReturnType<typeof freshStore>>;
beforeEach(async () => { store = await freshStore(); });
afterEach(() => { process.env.SAFEHER_FORCE_DEMO = "true"; });

describe("testing never alerts real people", () => {
  it("a simulated voice trigger outside demo mode is a dry run with no recipients", async () => {
    // Simulate a non-demo environment for this call only.
    process.env.SAFEHER_FORCE_DEMO = "false";
    const prevEnv = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const user = (await store.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!;
      const { event, responses } = await createEmergency(user, { trigger: "voice_simulated", location: null });
      expect(responses).toHaveLength(0);
      expect(event.isSimulated).toBe(true);
      expect(event.authorizedViewerIds).toEqual([]);
      expect(event.escalationConfig.enabled).toBe(false);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prevEnv ?? "test";
    }
  });
});

describe("data retention", () => {
  it("deletes closed events older than the user's retention period, never active ones", async () => {
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    await store.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, "sos_demo_past", { createdAt: old });
    const user = (await store.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!;
    const { event: active } = await createEmergency(user, { trigger: "manual", location: null });
    await store.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, active.id, { createdAt: old });

    const { deleted } = await applyRetention();
    expect(deleted).toBe(1);
    expect(await store.get(COLLECTIONS.emergencyEvents, "sos_demo_past")).toBeNull();
    expect(await store.get(COLLECTIONS.emergencyResponses, "sos_demo_past__tc_demo_anita")).toBeNull();
    expect(await store.get(COLLECTIONS.emergencyEvents, active.id)).not.toBeNull();
  });
});
