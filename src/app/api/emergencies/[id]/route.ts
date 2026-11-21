import { emergencyUpdateSchema } from "@/core/validation";
import { authed, parseBody } from "@/server/http";
import { closeEmergency, getEmergency } from "@/server/services/emergencies";

/** Event + per-contact response statuses. Owner or alerted contacts only. */
export const GET = authed<{ id: string }>(async ({ auth, params }) => getEmergency(auth, params.id));

/** Cancel (false alarm) or resolve (I'm safe). Owner only. */
export const PATCH = authed<{ id: string }>(async ({ req, auth, params }) => {
  const { action, note } = await parseBody(req, emergencyUpdateSchema);
  return { event: await closeEmergency(auth, params.id, action, note) };
});
