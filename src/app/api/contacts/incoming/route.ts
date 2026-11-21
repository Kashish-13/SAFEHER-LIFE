import { authed } from "@/server/http";
import { listIncoming } from "@/server/services/contacts";

/** People who have the caller in their emergency circle. */
export const GET = authed(async ({ auth }) => ({ incoming: await listIncoming(auth.uid) }));
