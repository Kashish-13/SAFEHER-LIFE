import { authed } from "@/server/http";
import { adminEmergencyActivity } from "@/server/services/admin";

/** Redacted emergency activity: no locations, notes or contact details. */
export const GET = authed(async () => ({ events: await adminEmergencyActivity() }), { roles: ["admin"] });
