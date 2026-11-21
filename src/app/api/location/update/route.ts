import { locationUpdateSchema } from "@/core/validation";
import { authed, parseBody } from "@/server/http";
import { publishLocation } from "@/server/services/location";

/** Owner's device publishes its current position to all live sharing sessions. */
export const POST = authed(async ({ req, auth }) => {
  const { location } = await parseBody(req, locationUpdateSchema);
  return publishLocation(auth.uid, location);
});
