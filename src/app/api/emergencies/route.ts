import { emergencyCreateSchema } from "@/core/validation";
import { requireProfile } from "@/server/auth";
import { authed, parseBody } from "@/server/http";
import { RATE_LIMITS } from "@/server/rate-limit";
import { createEmergency, listEmergencyHistory } from "@/server/services/emergencies";

/** Emergency history for the signed-in user. */
export const GET = authed(async ({ auth }) => ({ events: await listEmergencyHistory(auth.uid) }));

/**
 * EMERGENCY TRIGGER API — used by manual SOS (web) and by the future native
 * app's on-device voice detection (`trigger: "voice"`). See docs/API.md.
 * Returns 200 with `deduplicated: true` if an emergency is already active.
 */
export const POST = authed(
  async ({ req, auth }) => {
    const profile = requireProfile(auth);
    const input = await parseBody(req, emergencyCreateSchema);
    return createEmergency(profile, input);
  },
  { rateLimit: RATE_LIMITS.sos },
);
