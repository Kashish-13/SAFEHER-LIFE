import { authed } from "@/server/http";
import { RATE_LIMITS } from "@/server/rate-limit";
import { lookupInvitation } from "@/server/services/contacts";

/** Preview an invitation before accepting (requires sign-in). */
export const GET = authed<{ token: string }>(async ({ params }) => ({ invitation: await lookupInvitation(params.token) }), {
  rateLimit: RATE_LIMITS.auth,
});
