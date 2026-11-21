import { journeyUpdateSchema } from "@/core/validation";
import { requireProfile } from "@/server/auth";
import { authed, parseBody } from "@/server/http";
import { updateJourney } from "@/server/services/journeys";

/** Check in, confirm arrival, extend, or cancel. */
export const PATCH = authed<{ id: string }>(async ({ req, auth, params }) => {
  const profile = requireProfile(auth);
  const { action, extendMinutes } = await parseBody(req, journeyUpdateSchema);
  return { journey: await updateJourney(profile, params.id, action, extendMinutes) };
});
