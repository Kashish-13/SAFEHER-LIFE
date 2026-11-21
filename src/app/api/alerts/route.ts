import { authed } from "@/server/http";
import { listAlertsForContact } from "@/server/services/emergencies";

/** Emergency alerts addressed to the caller as a trusted contact. */
export const GET = authed(async ({ auth }) => {
  const alerts = await listAlertsForContact(auth.uid);
  return {
    alerts: alerts.map(({ event, response }) => ({
      eventId: event.id,
      fromName: event.userName,
      status: event.status,
      trigger: event.trigger,
      isSimulated: event.isSimulated,
      createdAt: event.createdAt,
      myResponse: response.status,
      tier: response.tier,
    })),
  };
});
