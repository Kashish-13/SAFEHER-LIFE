import { z } from "zod";
import { requireProfile } from "@/server/auth";
import { authed, parseBody } from "@/server/http";
import { registerPushToken } from "@/server/services/users";

/** Registers an FCM device token for push alerts (web or native). */
export const POST = authed(async ({ req, auth }) => {
  requireProfile(auth);
  const { token } = await parseBody(req, z.object({ token: z.string().min(20).max(4096) }));
  await registerPushToken(auth.uid, token);
  return { ok: true };
});
