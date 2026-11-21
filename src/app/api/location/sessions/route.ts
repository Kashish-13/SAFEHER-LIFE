import { locationShareCreateSchema } from "@/core/validation";
import { requireProfile } from "@/server/auth";
import { authed, parseBody } from "@/server/http";
import { listMySessions, startSharing } from "@/server/services/location";

export const GET = authed(async ({ auth }) => ({ sessions: await listMySessions(auth.uid) }));

export const POST = authed(async ({ req, auth }) => {
  const profile = requireProfile(auth);
  return { session: await startSharing(profile, await parseBody(req, locationShareCreateSchema)) };
});
