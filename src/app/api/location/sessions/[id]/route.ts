import { locationShareUpdateSchema } from "@/core/validation";
import { authed, parseBody } from "@/server/http";
import { updateSharing } from "@/server/services/location";

/** Pause, resume or stop (revoke) a sharing session. */
export const PATCH = authed<{ id: string }>(async ({ req, auth, params }) => {
  const { action } = await parseBody(req, locationShareUpdateSchema);
  return { session: await updateSharing(auth.uid, params.id, action) };
});
