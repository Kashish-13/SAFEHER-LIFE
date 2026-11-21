import { canViewEmergency } from "@/core/permissions";
import type { EmergencyEvent } from "@/core/types";
import { forbidden, notFound } from "@/server/errors";
import { authed } from "@/server/http";
import { runEscalation } from "@/server/services/emergencies";
import { getStore } from "@/server/store";
import { COLLECTIONS } from "@/server/store/types";

/**
 * Idempotent escalation check. Called by the owner's open emergency screen
 * (every few seconds) and by the scheduled cron job, whichever comes first.
 */
export const POST = authed<{ id: string }>(async ({ auth, params }) => {
  const event = await getStore().get<EmergencyEvent>(COLLECTIONS.emergencyEvents, params.id);
  if (!event) throw notFound();
  if (!canViewEmergency(auth, event)) throw forbidden();
  return runEscalation(params.id);
});
