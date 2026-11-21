import { evaluateJourney } from "@/core/journey";
import { journeyCreateSchema } from "@/core/validation";
import { requireProfile } from "@/server/auth";
import { authed, parseBody } from "@/server/http";
import { listJourneys, startJourney } from "@/server/services/journeys";

export const GET = authed(async ({ auth }) => {
  const now = new Date();
  const journeys = await listJourneys(auth.uid);
  return { journeys: journeys.map((j) => ({ ...j, state: evaluateJourney(j, now) })) };
});

export const POST = authed(async ({ req, auth }) => {
  const profile = requireProfile(auth);
  return { journey: await startJourney(profile, await parseBody(req, journeyCreateSchema)) };
});
