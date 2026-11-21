import { circleSchema } from "@/core/validation";
import { requireProfile } from "@/server/auth";
import { authed, parseBody } from "@/server/http";
import { createCircle, listCircles } from "@/server/services/circles";

export const GET = authed(async ({ auth }) => ({ circles: await listCircles(auth.uid) }));

export const POST = authed(async ({ req, auth }) => {
  requireProfile(auth);
  return { circle: await createCircle(auth.uid, await parseBody(req, circleSchema)) };
});
