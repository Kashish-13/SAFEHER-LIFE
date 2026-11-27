import { authed } from "@/server/http";
import { RATE_LIMITS } from "@/server/rate-limit";
import { revokeAllSessions } from "@/server/services/users";

/** Sign out everywhere: revoke every session on every device, including this one. */
export const DELETE = authed(
  async ({ auth }) => {
    await revokeAllSessions(auth.uid);
    return { ok: true };
  },
  { rateLimit: RATE_LIMITS.auth },
);
