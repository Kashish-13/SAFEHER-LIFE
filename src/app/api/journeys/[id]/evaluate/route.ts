import type { JourneySession } from "@/core/types";
import { forbidden, notFound } from "@/server/errors";
import { authed } from "@/server/http";
import { processJourney } from "@/server/services/journeys";
import { getStore } from "@/server/store";
import { COLLECTIONS } from "@/server/store/types";

/** Idempotent: applies reminders / escalation policy for the caller's journey. */
export const POST = authed<{ id: string }>(async ({ auth, params }) => {
  const j = await getStore().get<JourneySession>(COLLECTIONS.journeySessions, params.id);
  if (!j) throw notFound();
  if (j.userId !== auth.uid) throw forbidden();
  return processJourney(params.id);
});
