import { z } from "zod";
import { DEMO_OTP_CODE } from "@/core/defaults";
import { phoneSchema } from "@/core/validation";
import { requireProfile } from "@/server/auth";
import { isDemoMode } from "@/server/env";
import { badRequest } from "@/server/errors";
import { authed, parseBody } from "@/server/http";
import { RATE_LIMITS } from "@/server/rate-limit";
import { markPhoneVerified } from "@/server/services/users";


/**
 * Confirms phone verification.
 * - Firebase mode: the client completes Firebase Phone Auth (linkWithPhoneNumber);
 *   the server then checks the phone on the Firebase Auth record — the client's word is not trusted.
 * - Demo mode: accepts the simulated code.
 */
export const POST = authed(
  async ({ req, auth }) => {
    requireProfile(auth);
    const { phone, code } = await parseBody(req, z.object({ phone: phoneSchema, code: z.string().max(10).optional() }));
    if (isDemoMode() && code !== DEMO_OTP_CODE) throw badRequest("Incorrect verification code");
    return { profile: await markPhoneVerified(auth.uid, phone) };
  },
  { rateLimit: RATE_LIMITS.auth },
);
