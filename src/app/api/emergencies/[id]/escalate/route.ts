import type { EmergencyEvent } from "@/core/types";
import { notFound } from "@/server/errors";
import { authed } from "@/server/http";
import { assertEmergencyAccess, runEscalation } from "@/server/services/emergencies";
import { getStore } from "@/server/store";
import { COLLECTIONS } from "@/server/store/types";

/**
 * Idempotent escalation check. Today it is driven by the owner's open emergency
 * screen and the cron backstop. Phase 2 adds a server-side scheduler.
 */
export const POST = authed<{ id: string }>(async ({ auth, params }) => {
  const event = await getStore().get<EmergencyEvent>(COLLECTIONS.emergencyEvents, params.id);
  if (!event) throw notFound();
  await assertEmergencyAccess(auth, event);
  return runEscalation(params.id);
});
