import { invitationResponseSchema } from "@/core/validation";
import { requireProfile } from "@/server/auth";
import { authed, parseBody } from "@/server/http";
import { RATE_LIMITS } from "@/server/rate-limit";
import { respondToInvitation } from "@/server/services/contacts";

export const POST = authed(
  async ({ req, auth }) => {
    const profile = requireProfile(auth);
    const { token, decision } = await parseBody(req, invitationResponseSchema);
    return { contact: await respondToInvitation(profile, token, decision) };
  },
  { rateLimit: RATE_LIMITS.auth },
);
