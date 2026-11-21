import { emergencyRespondSchema } from "@/core/validation";
import { authed, parseBody } from "@/server/http";
import { respondToEmergency } from "@/server/services/emergencies";

/** A trusted contact confirms receipt, acknowledges, or declines an alert. */
export const POST = authed<{ id: string }>(async ({ req, auth, params }) => {
  const { action } = await parseBody(req, emergencyRespondSchema);
  return { response: await respondToEmergency(auth, params.id, action) };
});
