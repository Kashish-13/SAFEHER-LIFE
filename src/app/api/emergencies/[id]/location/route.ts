import { locationUpdateSchema } from "@/core/validation";
import { authed, parseBody } from "@/server/http";
import { updateEmergencyLocation } from "@/server/services/emergencies";

/** Owner's device pushes a fresher location during an active emergency. */
export const POST = authed<{ id: string }>(async ({ req, auth, params }) => {
  const { location } = await parseBody(req, locationUpdateSchema);
  const event = await updateEmergencyLocation(auth, params.id, location);
  return { ok: true, updatedAt: event.updatedAt };
});
