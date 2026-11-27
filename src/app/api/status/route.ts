import { authed } from "@/server/http";
import { getSafetyStatus } from "@/server/services/status";

/** App-shell status: active emergency, incoming alerts, unread count, pending approvals. */
export const GET = authed(async ({ auth }) => getSafetyStatus(auth.uid));
